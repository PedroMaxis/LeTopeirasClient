import { app, ipcMain, MessageChannelMain, type MessagePortMain, type WebContents } from 'electron';
import { z } from 'zod';
import { IpcChannel, type SystemAudioStart, type SystemAudioStatus } from '../shared/ipc';
import { loadNativeAddon } from './native';
import { assertTrustedSender } from './renderer';

const sourceIdSchema = z.string().regex(/^(screen|window):[\w:-]+$/);

interface ActiveCapture {
  capture: { stop(): void };
  port: MessagePortMain;
  owner: WebContents;
}

let active: ActiveCapture | null = null;

function stopActive(): void {
  if (!active) return;
  active.capture.stop();
  active.port.close();
  active = null;
}

/**
 * Captures PC audio for a screen share and streams 10 ms PCM blocks to the renderer through
 * a MessagePort. A window share captures only that app (include mode); a full screen share
 * captures everything except our own process tree (exclude mode), so call voices never echo.
 */
export function registerSystemAudio(): void {
  const loaded = loadNativeAddon();
  const status: SystemAudioStatus =
    'addon' in loaded ? { available: true } : { available: false, reason: loaded.error };

  ipcMain.handle(IpcChannel.SystemAudioStatus, (event): SystemAudioStatus => {
    assertTrustedSender(event);
    return status;
  });

  ipcMain.handle(IpcChannel.SystemAudioStart, (event, rawSourceId: unknown): SystemAudioStart => {
    assertTrustedSender(event);
    if (!('addon' in loaded)) return { ok: false, reason: loaded.error };
    const sourceId = sourceIdSchema.parse(rawSourceId);
    stopActive();

    let options: { pid: number; mode: 'include' | 'exclude' };
    if (sourceId.startsWith('window:')) {
      const hwnd = Number(sourceId.split(':')[1]);
      const pid = Number.isSafeInteger(hwnd) ? loaded.addon.windowProcessId(hwnd) : 0;
      if (!pid) return { ok: false, reason: 'não encontrei o processo dessa janela' };
      // Our own window would capture the call itself.
      if (pid === process.pid)
        return { ok: false, reason: 'o som do próprio LeTopeiras não vai junto' };
      options = { pid, mode: 'include' };
    } else {
      options = { pid: process.pid, mode: 'exclude' };
    }

    const { port1, port2 } = new MessageChannelMain();
    const capture = new loaded.addon.AudioCapture(options, (block) => port1.postMessage(block));
    try {
      capture.start();
    } catch (err) {
      port1.close();
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
    port1.start();
    const owner = event.sender;
    active = { capture, port: port1, owner };
    // A crashed renderer keeps its webContents (it gets reloaded), so stop on either.
    const stop = () => active?.owner === owner && stopActive();
    owner.once('destroyed', stop);
    owner.once('render-process-gone', stop);
    owner.postMessage(IpcChannel.SystemAudioPort, null, [port2]);
    return { ok: true, mode: options.mode };
  });

  ipcMain.handle(IpcChannel.SystemAudioStop, (event) => {
    assertTrustedSender(event);
    if (active?.owner === event.sender) stopActive();
  });

  app.on('before-quit', stopActive);
}
