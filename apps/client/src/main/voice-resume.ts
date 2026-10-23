import { ipcMain } from 'electron';
import { z } from 'zod';
import { IpcChannel, type VoiceResume } from '../shared/ipc';
import { assertTrustedSender } from './renderer';

const resumeSchema = z
  .object({
    channelId: z.number().int().positive(),
    muted: z.boolean(),
    deafened: z.boolean(),
    sharing: z.boolean(),
  })
  .nullable();

/** The room the renderer reports being in right now. Memory only. */
let current: VoiceResume | null = null;
/** What the reloaded renderer gets back, once. */
let pending: VoiceResume | null = null;

/**
 * Called right before main reloads a crashed renderer: the new page starts out of voice (and
 * says so), so the room is set aside here first.
 */
export function keepVoiceForReload(): void {
  pending = current;
  current = null;
}

export function registerVoiceResume(): void {
  ipcMain.handle(IpcChannel.VoiceResumeState, (event, rawState: unknown) => {
    assertTrustedSender(event);
    current = resumeSchema.parse(rawState);
  });

  ipcMain.handle(IpcChannel.VoiceTakeResume, (event): VoiceResume | null => {
    assertTrustedSender(event);
    const resume = pending;
    pending = null;
    return resume;
  });
}
