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

const PLAIN_PREFIX = 'plain:';

/**
 * Linux desktops without a keyring (Hyprland, sway, i3...) cannot encrypt. There the token
 * is kept in a file only the user can read, which is what Chromium's own "basic_text"
 * fallback amounts to anyway. Windows and macOS never take this path.
 */
const usePlainFallback = () => process.platform === 'linux' && !safeStorage.isEncryptionAvailable();

/** Keeps the session token on disk, encrypted with the OS (DPAPI on Windows, keyring on Linux). */
export function registerSessionStore(): void {
  ipcMain.handle(IpcChannel.SessionLoad, (event): string | null => {
    assertTrustedSender(event);
    if (memoryToken) return memoryToken;
    const file = sessionFile();
    if (!existsSync(file)) return null;
    try {
      const raw = readFileSync(file);
      if (raw.subarray(0, PLAIN_PREFIX.length).toString() === PLAIN_PREFIX) {
        if (!usePlainFallback()) throw new Error('plain session on a system with encryption');
        return tokenSchema.parse(raw.subarray(PLAIN_PREFIX.length).toString());
      }
      if (!safeStorage.isEncryptionAvailable()) return null;
      return tokenSchema.parse(safeStorage.decryptString(raw));
    } catch {
      rmSync(file, { force: true });
      return null;
    }
  });

  ipcMain.handle(IpcChannel.SessionSave, (event, rawToken: unknown) => {
    assertTrustedSender(event);
    const token = tokenSchema.parse(rawToken);
    if (usePlainFallback()) {
      writeFileSync(sessionFile(), PLAIN_PREFIX + token, { mode: 0o600 });
      return;
    }
    // Outside Linux never fall back to plain text: without encryption the user just logs in again.
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
