import { app, ipcMain, MessageChannelMain, type MessagePortMain, type WebContents } from 'electron';
import { z } from 'zod';
import { IpcChannel, type SystemAudioStart, type SystemAudioStatus } from '../shared/ipc';
import { linuxAudioAvailable, LinuxAudioCapture, x11WindowProcessId } from './linux-audio';
import { loadNativeAddon } from './native';
import { assertTrustedSender } from './renderer';

const sourceIdSchema = z.string().regex(/^(screen|window):[\w:-]+$/);

interface Backend {
  /** null when it can capture, else why not. */
  unavailable(): Promise<string | null>;
  create(
    options: { pid: number; mode: 'include' | 'exclude' },
    onData: (block: Float32Array) => void,
  ): { start(): Promise<void>; stop(): Promise<void> };
  /** Process that owns a window of the picker, 0 when unknown. */
  windowProcessId(windowId: number): Promise<number>;
}

/** Windows: the native process loopback addon. */
function windowsBackend(): Backend {
  const loaded = loadNativeAddon();
  return {
    unavailable: () => Promise.resolve('addon' in loaded ? null : loaded.error),
    create(options, onData) {
      if (!('addon' in loaded)) throw new Error(loaded.error);
      const capture = new loaded.addon.AudioCapture(options, onData);
      return {
        start: () => Promise.resolve(capture.start()),
        stop: () => Promise.resolve(capture.stop()),
      };
    },
    windowProcessId: (id) =>
      Promise.resolve('addon' in loaded ? loaded.addon.windowProcessId(id) : 0),
  };
}

/** Linux: PipeWire/PulseAudio routing, see linux-audio.ts. */
const linuxBackend: Backend = {
  unavailable: linuxAudioAvailable,
  create(options, onData) {
    const capture = new LinuxAudioCapture(options, onData);
    return { start: () => capture.start(), stop: () => capture.stop() };
  },
  windowProcessId: x11WindowProcessId,
};

interface ActiveCapture {
  capture: { stop(): Promise<void> };
  port: MessagePortMain;
  owner: WebContents;
}

let active: ActiveCapture | null = null;

function stopActive(): Promise<void> {
  if (!active) return Promise.resolve();
  const { capture, port } = active;
  active = null;
  port.close();
  return capture.stop();
}

/**
 * Captures PC audio for a screen share and streams 10 ms PCM blocks to the renderer through
 * a MessagePort. A window share captures only that app (include mode); a full screen share
 * captures everything except our own process tree (exclude mode), so call voices never echo.
 */
export function registerSystemAudio(): void {
  const backend =
    process.platform === 'linux'
      ? linuxBackend
      : process.platform === 'win32'
        ? windowsBackend()
        : null;

  ipcMain.handle(IpcChannel.SystemAudioStatus, async (event): Promise<SystemAudioStatus> => {
    assertTrustedSender(event);
    if (!backend) return { available: false, reason: 'só funciona no Windows e no Linux' };
    const reason = await backend.unavailable();
    return reason ? { available: false, reason } : { available: true };
  });

  ipcMain.handle(
    IpcChannel.SystemAudioStart,
    async (event, rawSourceId: unknown): Promise<SystemAudioStart> => {
      assertTrustedSender(event);
      if (!backend) return { ok: false, reason: 'só funciona no Windows e no Linux' };
      const unavailable = await backend.unavailable();
      if (unavailable) return { ok: false, reason: unavailable };
      const sourceId = sourceIdSchema.parse(rawSourceId);
      await stopActive();

      let options: { pid: number; mode: 'include' | 'exclude' };
      if (sourceId.startsWith('window:')) {
        const id = Number(sourceId.split(':')[1]);
        const pid = Number.isSafeInteger(id) ? await backend.windowProcessId(id) : 0;
        if (pid) {
          // Our own window would capture the call itself.
          if (pid === process.pid)
            return { ok: false, reason: 'o som do próprio LeTopeiras não vai junto' };
          options = { pid, mode: 'include' };
        } else if (process.platform === 'linux') {
          // Wayland windows come from the portal and carry no pid: share the whole system
          // sound minus ours, which still keeps the call out.
          options = { pid: process.pid, mode: 'exclude' };
        } else {
          return { ok: false, reason: 'não encontrei o processo dessa janela' };
        }
      } else {
        options = { pid: process.pid, mode: 'exclude' };
      }

      const { port1, port2 } = new MessageChannelMain();
      let capture: ReturnType<Backend['create']>;
      try {
        capture = backend.create(options, (block) => port1.postMessage(block));
        await capture.start();
      } catch (err) {
        port1.close();
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
      port1.start();
      const owner = event.sender;
      active = { capture, port: port1, owner };
      // A crashed renderer keeps its webContents (it gets reloaded), so stop on either.
      const stop = () => active?.owner === owner && void stopActive();
      owner.once('destroyed', stop);
      owner.once('render-process-gone', stop);
      owner.postMessage(IpcChannel.SystemAudioPort, null, [port2]);
      return { ok: true, mode: options.mode };
    },
  );

  ipcMain.handle(IpcChannel.SystemAudioStop, async (event) => {
    assertTrustedSender(event);
    if (active?.owner === event.sender) await stopActive();
  });

  // Linux leaves a sink behind in the sound server, so quitting waits for the cleanup.
  app.on('before-quit', (event) => {
    if (!active) return;
    event.preventDefault();
    void stopActive().finally(() => app.quit());
  });
}
