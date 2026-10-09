import { app, ipcMain, type WebContents } from 'electron';
import { z } from 'zod';
import { IpcChannel, type PushToTalkKey, type PushToTalkStatus } from '../shared/ipc';
import { cancelRecording, keyName, POLL_MS, recordKey } from './keys';
import { loadNativeAddon } from './native';
import { assertTrustedSender } from './renderer';

const vkSchema = z.number().int().min(1).max(254);

interface Watch {
  owner: WebContents;
  timer: ReturnType<typeof setInterval>;
}

let watch: Watch | null = null;

function stopWatch(): void {
  if (!watch) return;
  clearInterval(watch.timer);
  watch = null;
}

/**
 * Push-to-talk needs key presses and releases while other apps have focus, which
 * globalShortcut can't report, so main polls GetAsyncKeyState through the native addon and
 * tells the renderer when the key goes down or up. Polling only runs while in a voice room.
 */
export function registerPushToTalk(): void {
  const loaded = loadNativeAddon();
  const status: PushToTalkStatus =
    'addon' in loaded ? { available: true } : { available: false, reason: loaded.error };

  ipcMain.handle(IpcChannel.PushToTalkStatus, (event): PushToTalkStatus => {
    assertTrustedSender(event);
    return status;
  });

  ipcMain.handle(IpcChannel.PushToTalkStart, (event, rawVk: unknown) => {
    assertTrustedSender(event);
    if (!('addon' in loaded)) return;
    const vk = vkSchema.parse(rawVk);
    const { addon } = loaded;
    stopWatch();
    const owner = event.sender;
    let down = false;
    const timer = setInterval(() => {
      const now = addon.isKeyDown(vk);
      if (now === down) return;
      down = now;
      if (!owner.isDestroyed()) owner.send(IpcChannel.PushToTalkState, down);
    }, POLL_MS);
    watch = { owner, timer };
    // A crashed renderer keeps its webContents (it gets reloaded), so stop on either.
    const stop = () => watch?.owner === owner && stopWatch();
    owner.once('destroyed', stop);
    owner.once('render-process-gone', stop);
  });

  ipcMain.handle(IpcChannel.PushToTalkStop, (event) => {
    assertTrustedSender(event);
    if (watch?.owner === event.sender) stopWatch();
  });

  ipcMain.handle(IpcChannel.PushToTalkRecordKey, async (event): Promise<PushToTalkKey | null> => {
    assertTrustedSender(event);
    if (!('addon' in loaded)) return null;
    const key = await recordKey(loaded.addon, false);
    return key && { vk: key.vk, name: keyName(loaded.addon, key.vk) };
  });

  app.on('before-quit', () => {
    stopWatch();
    cancelRecording();
  });
}
