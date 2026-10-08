import { appendFileSync, renameSync } from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';
import { app, crashReporter, ipcMain, powerMonitor, screen, type BrowserWindow } from 'electron';
import { z } from 'zod';
import { IpcChannel } from '../shared/ipc';
import { assertTrustedSender } from './renderer';

/** More renderer crashes than this within the window leaves the page dead instead of looping. */
const RELOAD_LIMIT = 3;
const RELOAD_WINDOW_MS = 60_000;
const MAX_DATA_CHARS = 4000;

const eventSchema = z.string().regex(/^[\w.:-]{1,64}$/);
const dataSchema = z.record(z.string(), z.unknown()).optional();

let logPath: string | null = null;

/** Local minidumps only (in `app.getPath('crashDumps')`); nothing is ever uploaded. */
export function startCrashReporter(): void {
  crashReporter.start({ uploadToServer: false });
}

/**
 * Appends one JSON line to `%APPDATA%\LeTopeiras Client\letopeiras.log`. The file holds the
 * current session; the previous one is kept as `letopeiras.old.log`, so after a crash and a
 * restart friends can still send what happened. Local only, never uploaded.
 */
export function logEvent(event: string, data?: Record<string, unknown>): void {
  if (!logPath) return;
  const line = JSON.stringify({ time: new Date().toISOString(), event, ...data });
  try {
    appendFileSync(logPath, `${line}\n`);
  } catch {
    // Logging must never take the app down with it.
  }
}

function openLog(): void {
  const dir = app.getPath('userData');
  logPath = join(dir, 'letopeiras.log');
  try {
    renameSync(logPath, join(dir, 'letopeiras.old.log'));
  } catch {
    // First run: nothing to keep.
  }
}

function displays(): unknown[] {
  return screen.getAllDisplays().map((d) => ({
    id: d.id,
    size: `${d.size.width}x${d.size.height}`,
    scale: d.scaleFactor,
    hz: d.displayFrequency,
  }));
}

async function logGpu(): Promise<void> {
  try {
    const info = (await app.getGPUInfo('basic')) as { gpuDevice?: unknown };
    logEvent('main.gpu', { devices: info.gpuDevice });
  } catch (err) {
    logEvent('main.gpu', { error: String(err) });
  }
}

/**
 * Session log plus crash recovery: logs crashed child processes and reloads the main window
 * when its renderer dies, so the user isn't left with an empty window. The renderer adds its
 * own events (screen share, encoder, errors) through `IpcChannel.LogEvent`.
 */
export function registerDiagnostics(getWindow: () => BrowserWindow | null): void {
  openLog();
  logEvent('main.start', {
    version: app.getVersion(),
    electron: process.versions.electron,
    windows: release(),
    displays: displays(),
  });
  void logGpu();

  ipcMain.handle(IpcChannel.LogEvent, (event, rawName: unknown, rawData: unknown) => {
    assertTrustedSender(event);
    const name = eventSchema.parse(rawName);
    const data = dataSchema.parse(rawData);
    const json = data ? JSON.stringify(data) : '';
    logEvent(
      name,
      json.length > MAX_DATA_CHARS ? { truncated: json.slice(0, MAX_DATA_CHARS) } : data,
    );
  });

  // Closing a fullscreen game or a virtual display can change the display setup mid-share.
  const onDisplays = (change: string) => () =>
    logEvent('main.displays', { change, displays: displays() });
  screen.on('display-added', onDisplays('added'));
  screen.on('display-removed', onDisplays('removed'));
  screen.on('display-metrics-changed', onDisplays('metrics'));
  powerMonitor.on('suspend', () => logEvent('main.suspend'));
  powerMonitor.on('resume', () => logEvent('main.resume'));

  const reloads: number[] = [];
  app.on('render-process-gone', (_event, contents, details) => {
    logEvent('main.renderer-gone', { reason: details.reason, exitCode: details.exitCode });
    const win = getWindow();
    if (!win || win.isDestroyed() || win.webContents !== contents) return;
    if (details.reason === 'clean-exit') return;
    const now = Date.now();
    while (reloads.length > 0 && now - (reloads[0] ?? 0) > RELOAD_WINDOW_MS) reloads.shift();
    if (reloads.length >= RELOAD_LIMIT) return;
    reloads.push(now);
    logEvent('main.reload');
    contents.reload();
  });

  app.on('child-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    logEvent('main.child-gone', {
      process: details.type,
      name: details.name,
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });

  app.on('before-quit', () => logEvent('main.quit'));
}
