import { app, ipcMain, type WebContents } from 'electron';
import { z } from 'zod';
import { IpcChannel, type PushToTalkKey, type PushToTalkStatus } from '../shared/ipc';
import { loadNativeAddon, type NativeAddon } from './native';
import { assertTrustedSender } from './renderer';

const POLL_MS = 15;
const RECORD_TIMEOUT_MS = 10_000;

const VK_ESCAPE = 0x1b;
/**
 * Left/right click would fire when pressing "Gravar" itself; generic Shift/Ctrl/Alt duplicate
 * their left/right variants.
 */
const RECORD_IGNORED = new Set([0x01, 0x02, 0x10, 0x11, 0x12]);
const MOUSE_NAMES: Record<number, string> = {
  0x04: 'Botão do meio',
  0x05: 'Mouse 4',
  0x06: 'Mouse 5',
};

const vkSchema = z.number().int().min(1).max(254);

function keyName(addon: NativeAddon, vk: number): string {
  const name = MOUSE_NAMES[vk] ?? addon.keyName(vk);
  return name && !name.startsWith('<') ? name : `Tecla ${vk}`;
}

interface Watch {
  owner: WebContents;
  timer: ReturnType<typeof setInterval>;
}

interface Recording {
  timer: ReturnType<typeof setInterval>;
  finish(key: PushToTalkKey | null): void;
}

let watch: Watch | null = null;
let recording: Recording | null = null;

function stopWatch(): void {
  if (!watch) return;
  clearInterval(watch.timer);
  watch = null;
}

function cancelRecording(): void {
  recording?.finish(null);
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
    owner.once('destroyed', () => watch?.owner === owner && stopWatch());
  });

  ipcMain.handle(IpcChannel.PushToTalkStop, (event) => {
    assertTrustedSender(event);
    if (watch?.owner === event.sender) stopWatch();
  });

  ipcMain.handle(IpcChannel.PushToTalkRecordKey, (event): Promise<PushToTalkKey | null> => {
    assertTrustedSender(event);
    if (!('addon' in loaded)) return Promise.resolve(null);
    const { addon } = loaded;
    cancelRecording();
    return new Promise((resolve) => {
      // Only a key that goes down after recording starts counts, not one already held.
      const held = new Set<number>();
      for (let vk = 1; vk <= 254; vk++) if (addon.isKeyDown(vk)) held.add(vk);
      const startedAt = Date.now();
      const current: Recording = {
        timer: setInterval(() => {
          if (Date.now() - startedAt > RECORD_TIMEOUT_MS) return current.finish(null);
          for (let vk = 1; vk <= 254; vk++) {
            if (!addon.isKeyDown(vk)) {
              held.delete(vk);
              continue;
            }
            if (held.has(vk) || RECORD_IGNORED.has(vk)) continue;
            return current.finish(vk === VK_ESCAPE ? null : { vk, name: keyName(addon, vk) });
          }
        }, POLL_MS),
        finish(key: PushToTalkKey | null) {
          clearInterval(current.timer);
          if (recording === current) recording = null;
          resolve(key);
        },
      };
      recording = current;
    });
  });

  app.on('before-quit', () => {
    stopWatch();
    cancelRecording();
  });
}
