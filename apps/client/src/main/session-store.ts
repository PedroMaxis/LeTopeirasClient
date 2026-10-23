import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, ipcMain, safeStorage } from 'electron';
import { z } from 'zod';
import { IpcChannel } from '../shared/ipc';
import { assertTrustedSender } from './renderer';

const tokenSchema = z.string().min(1).max(256);

const sessionFile = () => join(app.getPath('userData'), 'session.bin');

/**
 * The current session's token, in memory only: without "Manter conectado" it would otherwise
 * be lost when a crashed renderer is reloaded, logging the user out.
 */
let memoryToken: string | null = null;

/** Keeps the session token on disk, encrypted with the OS (DPAPI on Windows). */
export function registerSessionStore(): void {
  ipcMain.handle(IpcChannel.SessionLoad, (event): string | null => {
    assertTrustedSender(event);
    if (memoryToken) return memoryToken;
    const file = sessionFile();
    if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) return null;
    try {
      return tokenSchema.parse(safeStorage.decryptString(readFileSync(file)));
    } catch {
      rmSync(file, { force: true });
      return null;
    }
  });

  ipcMain.handle(IpcChannel.SessionSave, (event, rawToken: unknown) => {
    assertTrustedSender(event);
    const token = tokenSchema.parse(rawToken);
    // Never fall back to plain text: without encryption the user just logs in again.
    if (!safeStorage.isEncryptionAvailable()) return;
    writeFileSync(sessionFile(), safeStorage.encryptString(token));
  });

  ipcMain.handle(IpcChannel.SessionRemember, (event, rawToken: unknown) => {
    assertTrustedSender(event);
    memoryToken = tokenSchema.parse(rawToken);
  });

  ipcMain.handle(IpcChannel.SessionClear, (event) => {
    assertTrustedSender(event);
    memoryToken = null;
    rmSync(sessionFile(), { force: true });
  });
}
