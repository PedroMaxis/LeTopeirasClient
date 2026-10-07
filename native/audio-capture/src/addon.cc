// Windows process loopback capture for LeTopeiras.
//
// Captures either everything the PC plays except one process tree (exclude mode; we pass
// our own main process so the voices of the call never loop back), or only one process
// tree (include mode; the app whose window is being shared).
//
// Output: interleaved float32 stereo at 48 kHz, in blocks of 480 frames (10 ms), handed to
// a JS callback on the main thread through a ThreadSafeFunction.
//
// Reference: Microsoft's "ApplicationLoopback" sample. Requires Windows 10 2004 (19041)+.

#include <napi.h>

#include <windows.h>

#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <avrt.h>
#include <mmdeviceapi.h>
#include <wrl/client.h>
#include <wrl/implements.h>

#include <atomic>
#include <cstring>
#include <future>
#include <string>
#include <thread>
#include <vector>

using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::ComPtr;
using Microsoft::WRL::FtmBase;
using Microsoft::WRL::Make;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;

namespace {

constexpr UINT32 kSampleRate = 48000;
constexpr UINT16 kChannels = 2;
constexpr UINT32 kBlockFrames = kSampleRate / 100;  // 10 ms
constexpr REFERENCE_TIME kBufferDuration = 200000;  // 20 ms, in 100 ns units
constexpr size_t kMaxQueuedBlocks = 50;             // 500 ms; older blocks are dropped

std::string HResultMessage(const char* what, HRESULT hr) {
  char buffer[128];
  snprintf(buffer, sizeof(buffer), "%s failed (HRESULT 0x%08lX)", what,
           static_cast<unsigned long>(hr));
  return buffer;
}

// Receives the IAudioClient from ActivateAudioInterfaceAsync. Must be agile (FtmBase).
class ActivationHandler
    : public RuntimeClass<RuntimeClassFlags<ClassicCom>, FtmBase,
                          IActivateAudioInterfaceCompletionHandler> {
 public:
  ActivationHandler() : done_(CreateEventW(nullptr, TRUE, FALSE, nullptr)) {}
  ~ActivationHandler() override { CloseHandle(done_); }

  STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation* operation) override {
    HRESULT activateResult = E_FAIL;
    ComPtr<IUnknown> unknown;
    result_ = operation->GetActivateResult(&activateResult, &unknown);
    if (SUCCEEDED(result_)) result_ = activateResult;
    if (SUCCEEDED(result_)) result_ = unknown.As(&client_);
    SetEvent(done_);
    return S_OK;
  }

  HRESULT Wait(ComPtr<IAudioClient>& client) {
    if (WaitForSingleObject(done_, 5000) != WAIT_OBJECT_0) return HRESULT_FROM_WIN32(ERROR_TIMEOUT);
    if (SUCCEEDED(result_)) client = client_;
    return result_;
  }

 private:
  HANDLE done_;
  HRESULT result_ = E_FAIL;
  ComPtr<IAudioClient> client_;
};

struct Block {
  std::vector<float> samples;
};

class Capture {
 public:
  Capture(DWORD pid, bool include) : pid_(pid), include_(include) {}
  ~Capture() { Stop(); }

  // Starts the capture thread and waits until the audio client runs (or fails).
  std::string Start(Napi::ThreadSafeFunction tsfn) {
    tsfn_ = std::move(tsfn);
    stopEvent_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    std::promise<std::string> started;
    auto startedFuture = started.get_future();
    thread_ = std::thread([this, &started] { Run(started); });
    std::string error = startedFuture.get();
    if (!error.empty()) Stop();
    return error;
  }

  void Stop() {
    if (stopEvent_) SetEvent(stopEvent_);
    if (thread_.joinable()) thread_.join();
    if (stopEvent_) {
      CloseHandle(stopEvent_);
      stopEvent_ = nullptr;
    }
    if (tsfn_) {
      tsfn_.Release();
      tsfn_ = Napi::ThreadSafeFunction();
    }
  }

 private:
  void Run(std::promise<std::string>& started) {
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    bool comInitialized = SUCCEEDED(hr);
    HANDLE sampleEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    ComPtr<IAudioClient> client;
    ComPtr<IAudioCaptureClient> captureClient;
    std::string error = Initialize(sampleEvent, client, captureClient);
    bool running = error.empty();
    started.set_value(error);  // `started` is invalid after this line.

    // Ask MMCSS for audio priority; failure only means more jitter.
    DWORD taskIndex = 0;
    HANDLE mmcss = running ? AvSetMmThreadCharacteristicsW(L"Audio", &taskIndex) : nullptr;

    std::vector<float> pending;
    pending.reserve(kBlockFrames * kChannels * 4);
    HANDLE waits[] = {stopEvent_, sampleEvent};

    while (running) {
      DWORD signaled = WaitForMultipleObjects(2, waits, FALSE, 200);
      if (signaled == WAIT_OBJECT_0) break;
      UINT32 packetFrames = 0;
      while (SUCCEEDED(captureClient->GetNextPacketSize(&packetFrames)) && packetFrames > 0) {
        BYTE* data = nullptr;
        UINT32 frames = 0;
        DWORD flags = 0;
        if (FAILED(captureClient->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) break;
        size_t count = static_cast<size_t>(frames) * kChannels;
        size_t offset = pending.size();
        pending.resize(offset + count);
        if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
          std::memset(pending.data() + offset, 0, count * sizeof(float));
        } else {
          std::memcpy(pending.data() + offset, data, count * sizeof(float));
        }
        captureClient->ReleaseBuffer(frames);
      }
      EmitBlocks(pending);
    }

    if (client) client->Stop();
    if (mmcss) AvRevertMmThreadCharacteristics(mmcss);
    captureClient.Reset();
    client.Reset();
    CloseHandle(sampleEvent);
    if (comInitialized) CoUninitialize();
  }

  std::string Initialize(HANDLE sampleEvent, ComPtr<IAudioClient>& client,
                         ComPtr<IAudioCaptureClient>& captureClient) {
    AUDIOCLIENT_ACTIVATION_PARAMS params = {};
    params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    params.ProcessLoopbackParams.TargetProcessId = pid_;
    params.ProcessLoopbackParams.ProcessLoopbackMode =
        include_ ? PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
                 : PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;

    PROPVARIANT activateParams = {};
    activateParams.vt = VT_BLOB;
    activateParams.blob.cbSize = sizeof(params);
    activateParams.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

    auto handler = Make<ActivationHandler>();
    ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
    HRESULT hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
                                             __uuidof(IAudioClient), &activateParams,
                                             handler.Get(), &operation);
    if (FAILED(hr)) return HResultMessage("ActivateAudioInterfaceAsync", hr);
    hr = handler->Wait(client);
    if (FAILED(hr)) return HResultMessage("Process loopback activation", hr);

    // Process loopback has no mix format; the client converts to whatever we ask for.
    WAVEFORMATEX format = {};
    format.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
    format.nChannels = kChannels;
    format.nSamplesPerSec = kSampleRate;
    format.wBitsPerSample = 32;
    format.nBlockAlign = format.nChannels * format.wBitsPerSample / 8;
    format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;

    hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                            AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                                AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
                                AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                            kBufferDuration, 0, &format, nullptr);
    if (FAILED(hr)) return HResultMessage("IAudioClient::Initialize", hr);
    hr = client->GetService(IID_PPV_ARGS(&captureClient));
    if (FAILED(hr)) return HResultMessage("IAudioClient::GetService", hr);
    hr = client->SetEventHandle(sampleEvent);
    if (FAILED(hr)) return HResultMessage("IAudioClient::SetEventHandle", hr);
    hr = client->Start();
    if (FAILED(hr)) return HResultMessage("IAudioClient::Start", hr);
    return {};
  }

  void EmitBlocks(std::vector<float>& pending) {
    constexpr size_t blockSamples = static_cast<size_t>(kBlockFrames) * kChannels;
    size_t consumed = 0;
    while (pending.size() - consumed >= blockSamples) {
      auto* block = new Block{std::vector<float>(pending.begin() + consumed,
                                                 pending.begin() + consumed + blockSamples)};
      consumed += blockSamples;
      // Non-blocking: if JS falls behind, drop audio instead of stalling the capture.
      napi_status status = tsfn_.NonBlockingCall(block, [](Napi::Env env, Napi::Function fn,
                                                           Block* data) {
        if (env != nullptr && fn != nullptr) {
          auto array = Napi::Float32Array::New(env, data->samples.size());
          std::memcpy(array.Data(), data->samples.data(), data->samples.size() * sizeof(float));
          fn.Call({array});
        }
        delete data;
      });
      if (status != napi_ok) delete block;
    }
    pending.erase(pending.begin(), pending.begin() + consumed);
  }

  DWORD pid_;
  bool include_;
  HANDLE stopEvent_ = nullptr;
  std::thread thread_;
  Napi::ThreadSafeFunction tsfn_;
};

// JS: new AudioCapture({ pid, mode: 'include' | 'exclude' }, onData)
class AudioCapture : public Napi::ObjectWrap<AudioCapture> {
 public:
  static Napi::Function Init(Napi::Env env) {
    return DefineClass(env, "AudioCapture",
                       {InstanceMethod("start", &AudioCapture::Start),
                        InstanceMethod("stop", &AudioCapture::Stop)});
  }

  explicit AudioCapture(const Napi::CallbackInfo& info) : Napi::ObjectWrap<AudioCapture>(info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction()) {
      Napi::TypeError::New(env, "Expected (options, onData)").ThrowAsJavaScriptException();
      return;
    }
    auto options = info[0].As<Napi::Object>();
    auto pid = options.Get("pid");
    auto mode = options.Get("mode");
    if (!pid.IsNumber() || !mode.IsString()) {
      Napi::TypeError::New(env, "options.pid must be a number and options.mode a string")
          .ThrowAsJavaScriptException();
      return;
    }
    std::string modeName = mode.As<Napi::String>().Utf8Value();
    if (modeName != "include" && modeName != "exclude") {
      Napi::TypeError::New(env, "options.mode must be 'include' or 'exclude'")
          .ThrowAsJavaScriptException();
      return;
    }
    pid_ = pid.As<Napi::Number>().Uint32Value();
    include_ = modeName == "include";
    onData_ = Napi::Persistent(info[1].As<Napi::Function>());
  }

  ~AudioCapture() override { capture_.reset(); }

 private:
  Napi::Value Start(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (capture_) return env.Undefined();
    auto tsfn = Napi::ThreadSafeFunction::New(env, onData_.Value(), "letopeiras-audio",
                                              kMaxQueuedBlocks, 1);
    capture_ = std::make_unique<Capture>(pid_, include_);
    std::string error = capture_->Start(std::move(tsfn));
    if (!error.empty()) {
      capture_.reset();
      Napi::Error::New(env, error).ThrowAsJavaScriptException();
    }
    return env.Undefined();
  }

  Napi::Value Stop(const Napi::CallbackInfo& info) {
    capture_.reset();
    return info.Env().Undefined();
  }

  DWORD pid_ = 0;
  bool include_ = false;
  Napi::FunctionReference onData_;
  std::unique_ptr<Capture> capture_;
};

// JS: windowProcessId(hwnd) -> pid | 0
Napi::Value WindowProcessId(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Expected a window handle").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto hwnd = reinterpret_cast<HWND>(static_cast<intptr_t>(info[0].As<Napi::Number>().Int64Value()));
  DWORD pid = 0;
  if (IsWindow(hwnd)) GetWindowThreadProcessId(hwnd, &pid);
  return Napi::Number::New(env, pid);
}

// Push-to-talk polls these from the main process. GetAsyncKeyState sees keys and mouse
// buttons while other apps have focus (except elevated ones, which UIPI hides from us).
bool ReadVirtualKey(const Napi::CallbackInfo& info, int* vk) {
  if (info.Length() < 1 || !info[0].IsNumber()) return false;
  *vk = info[0].As<Napi::Number>().Int32Value();
  return *vk >= 1 && *vk <= 254;
}

// JS: isKeyDown(vk) -> boolean
Napi::Value IsKeyDown(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int vk = 0;
  if (!ReadVirtualKey(info, &vk)) {
    Napi::TypeError::New(env, "Expected a virtual-key code (1-254)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::Boolean::New(env, (GetAsyncKeyState(vk) & 0x8000) != 0);
}

// JS: keyName(vk) -> string ('' when the keyboard layout has no name for it)
Napi::Value KeyName(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int vk = 0;
  if (!ReadVirtualKey(info, &vk)) {
    Napi::TypeError::New(env, "Expected a virtual-key code (1-254)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  // Extended keys (arrows, Insert, right Ctrl/Alt...) need bit 24 set, or GetKeyNameText names
  // the numpad key that shares the scan code. MAPVK_VK_TO_VSC_EX doesn't flag all of them.
  UINT scan = MapVirtualKeyW(static_cast<UINT>(vk), MAPVK_VK_TO_VSC_EX);
  bool extended = (scan & 0xFF00) != 0;
  switch (vk) {
    case VK_PRIOR: case VK_NEXT: case VK_END: case VK_HOME:
    case VK_LEFT: case VK_UP: case VK_RIGHT: case VK_DOWN:
    case VK_SNAPSHOT: case VK_INSERT: case VK_DELETE: case VK_DIVIDE: case VK_NUMLOCK:
    case VK_LWIN: case VK_RWIN: case VK_APPS: case VK_RCONTROL: case VK_RMENU:
      extended = true;
  }
  LONG lParam = static_cast<LONG>((scan & 0xFF) << 16);
  if (extended) lParam |= 1 << 24;
  wchar_t name[64] = {};
  int length = scan ? GetKeyNameTextW(lParam, name, 64) : 0;
  return Napi::String::New(env, reinterpret_cast<const char16_t*>(name), length);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("AudioCapture", AudioCapture::Init(env));
  exports.Set("windowProcessId", Napi::Function::New(env, WindowProcessId));
  exports.Set("isKeyDown", Napi::Function::New(env, IsKeyDown));
  exports.Set("keyName", Napi::Function::New(env, KeyName));
  exports.Set("sampleRate", Napi::Number::New(env, kSampleRate));
  exports.Set("channels", Napi::Number::New(env, kChannels));
  exports.Set("blockFrames", Napi::Number::New(env, kBlockFrames));
  return exports;
}

}  // namespace

NODE_API_MODULE(audio_capture, Init)
