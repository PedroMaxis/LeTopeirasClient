import { app, ipcMain, type WebContents } from 'electron';
import { z } from 'zod';
import { IpcChannel, type Keybind, type VoiceAction } from '../shared/ipc';
import { cancelRecording, comboName, heldModifiers, POLL_MS, recordKey } from './keys';
import { loadNativeAddon } from './native';
import { assertTrustedSender } from './renderer';
import { updateTrayVoice } from './tray';

const modsSchema = z.array(z.enum(['ctrl', 'shift', 'alt'])).max(3);
const bindsSchema = z
  .array(
    z.object({
      action: z.enum(['toggleMute', 'toggleDeafen']),
      vk: z.number().int().min(1).max(254),
      mods: modsSchema,
    }),
  )
  .max(8);
const trayStateSchema = z.object({
  inVoice: z.boolean(),
  muted: z.boolean(),
  deafened: z.boolean(),
});

let timer: ReturnType<typeof setInterval> | undefined;

function stopWatching(): void {
  clearInterval(timer);
  timer = undefined;
}

function sendVoiceAction(target: WebContents, action: VoiceAction): void {
  if (!target.isDestroyed()) target.send(IpcChannel.VoiceAction, action);
}

/**
 * Global mute/deafen shortcuts and the tray's voice state. Like push-to-talk, shortcuts are
 * polled through the native addon (GetAsyncKeyState): unlike globalShortcut they don't steal
 * the key from the game, and mouse buttons work. A shortcut fires once per press, only when
 * exactly its modifiers are held.
 */
export function registerVoiceControls(): void {
  const loaded = loadNativeAddon();

  ipcMain.handle(IpcChannel.KeybindsSet, (event, rawBinds: unknown) => {
    assertTrustedSender(event);
    const binds = bindsSchema.parse(rawBinds);
    stopWatching();
    if (!('addon' in loaded) || binds.length === 0) return;
    const { addon } = loaded;
    const owner = event.sender;
    const active = binds.map(() => false);
    timer = setInterval(() => {
      const mods = heldModifiers(addon);
      binds.forEach((bind, i) => {
        const now =
          addon.isKeyDown(bind.vk) &&
          mods.length === bind.mods.length &&
          bind.mods.every((m) => mods.includes(m));
        if (now && !active[i]) sendVoiceAction(owner, bind.action);
        active[i] = now;
      });
    }, POLL_MS);
    // A crashed renderer gets reloaded and sends its shortcuts again.
    owner.once('destroyed', stopWatching);
    owner.once('render-process-gone', stopWatching);
  });

  ipcMain.handle(IpcChannel.KeybindRecord, async (event): Promise<Keybind | null> => {
    assertTrustedSender(event);
    if (!('addon' in loaded)) return null;
    const key = await recordKey(loaded.addon, true);
    return key && { ...key, name: comboName(loaded.addon, key.vk, key.mods) };
  });

  ipcMain.handle(IpcChannel.TrayVoiceState, (event, rawState: unknown) => {
    assertTrustedSender(event);
    updateTrayVoice(trayStateSchema.parse(rawState));
  });

  app.on('before-quit', () => {
    stopWatching();
    cancelRecording();
  });
}
