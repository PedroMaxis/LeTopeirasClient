import { SYSTEM_AUDIO_PORT_MESSAGE } from '../../../shared/ipc';
import workletUrl from './system-audio-worklet.ts?worker&url';

/** PC audio captured by the native addon, as a track ready to publish. */
export interface SystemAudio {
  track: MediaStreamTrack;
  /** 'include': only the shared app. 'exclude': everything except LeTopeiras. */
  mode: 'include' | 'exclude';
  stop(): void;
}

const PORT_TIMEOUT_MS = 3000;

function waitForPort(): { promise: Promise<MessagePort>; cancel(): void } {
  let onMessage: (event: MessageEvent) => void = () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<MessagePort>((resolve, reject) => {
    onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.data !== SYSTEM_AUDIO_PORT_MESSAGE) return;
      const [port] = event.ports;
      if (port) resolve(port);
    };
    timer = setTimeout(
      () => reject(new Error('o áudio não chegou do processo principal')),
      PORT_TIMEOUT_MS,
    );
    window.addEventListener('message', onMessage);
  });
  const cancel = () => {
    clearTimeout(timer);
    window.removeEventListener('message', onMessage);
  };
  void promise.then(cancel, cancel);
  return { promise, cancel };
}

/** Starts capturing the audio that goes with `sourceId` (see main/system-audio.ts). */
export async function startSystemAudio(sourceId: string): Promise<SystemAudio> {
  const port = waitForPort();
  const result = await window.api.startSystemAudio(sourceId);
  if (!result.ok) {
    port.cancel();
    throw new Error(result.reason);
  }

  let context: AudioContext | null = null;
  try {
    const messagePort = await port.promise;
    context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    await context.audioWorklet.addModule(workletUrl);
    const player = new AudioWorkletNode(context, 'letopeiras-pcm-player', {
      numberOfInputs: 0,
      outputChannelCount: [2],
    });
    // Hand the port to the worklet thread; PCM never passes through this thread.
    player.port.postMessage({ port: messagePort }, [messagePort]);
    const destination = context.createMediaStreamDestination();
    destination.channelCount = 2;
    player.connect(destination);

    const [track] = destination.stream.getAudioTracks();
    if (!track) throw new Error('não foi possível criar a trilha de áudio');
    track.contentHint = 'music';

    const ctx = context;
    return {
      track,
      mode: result.mode,
      stop: () => {
        void window.api.stopSystemAudio();
        player.disconnect();
        track.stop();
        void ctx.close();
      },
    };
  } catch (err) {
    void window.api.stopSystemAudio();
    void context?.close();
    throw err;
  }
}
