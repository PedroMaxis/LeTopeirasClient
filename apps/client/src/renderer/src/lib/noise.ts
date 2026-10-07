import { RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import workletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
// Inlined instead of fetched: packaged builds load from file://, which fetch() can't read.
// Chromium always has WASM SIMD, so the non-SIMD build isn't needed.
import wasmDataUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url&inline';

/** RNNoise processes 48 kHz audio; contexts that host it must run at this rate. */
export const NOISE_SAMPLE_RATE = 48000;

let wasm: ArrayBuffer | undefined;
const contextsWithModule = new WeakSet<BaseAudioContext>();

function decodeWasm(): ArrayBuffer {
  const bytes = Uint8Array.from(atob(wasmDataUrl.slice(wasmDataUrl.indexOf(',') + 1)), (c) =>
    c.charCodeAt(0),
  );
  return bytes.buffer;
}

/** An RNNoise node (mono) for `context`. Call `destroy()` when done to free its WASM memory. */
export async function createNoiseSuppressor(context: AudioContext): Promise<RnnoiseWorkletNode> {
  if (!contextsWithModule.has(context)) {
    await context.audioWorklet.addModule(workletUrl);
    contextsWithModule.add(context);
  }
  wasm ??= decodeWasm();
  const node = new RnnoiseWorkletNode(context, { wasmBinary: wasm, maxChannels: 1 });
  // Mics can show up as stereo; downmix so RNNoise sees one channel.
  node.channelCount = 1;
  node.channelCountMode = 'explicit';
  return node;
}
