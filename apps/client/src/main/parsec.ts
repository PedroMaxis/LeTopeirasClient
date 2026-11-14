import { execFile, spawn } from 'node:child_process';
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ipcMain } from 'electron';
import {
  IpcChannel,
  type ParsecEchoSetResult,
  type ParsecEchoStatus,
  type ParsecEchoTarget,
} from '../shared/ipc';
import { logEvent } from './diagnostics';
import { readEchoTarget, withEchoTarget } from './parsec-config';
import { assertTrustedSender } from './renderer';

// Settings → Transmissão → Parsec: keeps the call out of what Parsec guests hear when this PC
// hosts, by pointing Parsec's echo cancelling ("New") at our executable instead of Discord's.
// Parsec only reads config.json at startup and rewrites it when it closes, so the file is
// changed only while Parsec is closed. There's no command to quit it: the parsecd.exe started
// by its service runs as SYSTEM, and killing only the user's parsecd makes the service restart
// it without restarting the host side, where the echo mode lives.

const env = (name: string) => process.env[name] ?? '';

/** Per-user installs keep the config in %APPDATA%; shared installs may use %ProgramData%. */
function configPaths(): string[] {
  return [join(env('APPDATA'), 'Parsec'), join(env('ProgramData'), 'Parsec')]
    .map((dir) => join(dir, 'config.json'))
    .filter((file) => existsSync(file));
}

function parsecExe(): string | null {
  const candidates = [
    join(env('ProgramFiles'), 'Parsec', 'parsecd.exe'),
    join(env('APPDATA'), 'Parsec', 'parsecd.exe'),
  ];
  return candidates.find((file) => existsSync(file)) ?? null;
}

function isParsecRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'tasklist',
      ['/FI', 'IMAGENAME eq parsecd.exe', '/FO', 'CSV', '/NH'],
      { windowsHide: true },
      (error, stdout) => resolve(!error && stdout.toLowerCase().includes('"parsecd.exe"')),
    );
  });
}

// Strips a UTF-8 byte order mark, in case something saved the file with one.
const readText = async (file: string) => {
  const text = await readFile(file, 'utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
};

async function getStatus(): Promise<ParsecEchoStatus> {
  const [file] = configPaths();
  if (process.platform !== 'win32' || !file) return { available: false };
  let target: ParsecEchoTarget;
  try {
    target = readEchoTarget(await readText(file));
  } catch {
    return { available: false };
  }
  return { available: true, target, running: await isParsecRunning() };
}

async function setTarget(target: 'letopeiras' | 'discord'): Promise<ParsecEchoSetResult> {
  const files = process.platform === 'win32' ? configPaths() : [];
  if (files.length === 0) return { ok: false, reason: 'not-found' };
  if (await isParsecRunning()) return { ok: false, reason: 'running' };
  try {
    for (const file of files) {
      const next = withEchoTarget(await readText(file), target);
      const backup = `${file}.letopeiras-bak`;
      if (!existsSync(backup)) await copyFile(file, backup);
      const temp = `${file}.letopeiras-tmp`;
      await writeFile(temp, next, 'utf8');
      await rename(temp, file);
    }
  } catch (error) {
    logEvent('parsec_echo_failed', { message: String(error) });
    return { ok: false, reason: 'failed' };
  }
  logEvent('parsec_echo_set', { target, files: files.length });

  // Opening parsecd.exe goes through Parsec's service, like the Start menu shortcut does.
  const exe = parsecExe();
  if (!exe) return { ok: true, reopened: false };
  try {
    const child = spawn(exe, [], { detached: true, stdio: 'ignore' });
    child.on('error', (error) => logEvent('parsec_open_failed', { message: String(error) }));
    child.unref();
    return { ok: true, reopened: true };
  } catch {
    return { ok: true, reopened: false };
  }
}

export function registerParsec(): void {
  ipcMain.handle(IpcChannel.ParsecEchoGet, (event) => {
    assertTrustedSender(event);
    return getStatus();
  });
  ipcMain.handle(IpcChannel.ParsecEchoSet, (event, target: unknown) => {
    assertTrustedSender(event);
    if (target !== 'letopeiras' && target !== 'discord') throw new Error('Invalid target');
    return setTarget(target);
  });
}
