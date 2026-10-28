import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, screen, type BrowserWindow } from 'electron';
import { placeWindow, windowStateSchema, type Rect, type WindowState } from './window-bounds';

const stateFile = () => join(app.getPath('userData'), 'window-state.json');

const SAVE_DELAY_MS = 500;

/** The saved window state, or null when there is none or the file is broken. */
function load(): WindowState | null {
  try {
    return windowStateSchema.parse(JSON.parse(readFileSync(stateFile(), 'utf8')));
  } catch {
    return null;
  }
}

/**
 * Where to open the main window and whether it was maximized. `bounds` is empty (Electron
 * centers the window with its default size) when nothing usable was saved.
 */
export function restoreWindowState(min: { width: number; height: number }): {
  bounds: Partial<Rect>;
  maximized: boolean;
  zoom: number;
} {
  const saved = load();
  if (!saved) return { bounds: {}, maximized: false, zoom: 1 };
  const placed = placeWindow(
    saved,
    screen.getAllDisplays().map((d) => d.workArea),
    min,
  );
  return { bounds: placed ?? {}, maximized: saved.maximized, zoom: saved.zoom };
}

/**
 * Saves size, position, maximized and zoom while the window changes, and when it hides or quits.
 * Returns a function that schedules a save (for changes the window doesn't announce, like zoom).
 */
export function trackWindowState(win: BrowserWindow): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const save = () => {
    clearTimeout(timer);
    timer = undefined;
    if (win.isDestroyed()) return;
    // Normal bounds: the size to come back to when un-maximizing, even while maximized.
    const state: WindowState = {
      ...win.getNormalBounds(),
      maximized: win.isMaximized(),
      zoom: win.webContents.getZoomFactor(),
    };
    try {
      writeFileSync(stateFile(), JSON.stringify(state));
    } catch {
      // Not worth bothering anyone: the window just opens at the default place next time.
    }
  };
  const saveSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY_MS);
  };

  win.on('resize', saveSoon);
  win.on('move', saveSoon);
  win.on('maximize', saveSoon);
  win.on('unmaximize', saveSoon);
  win.on('hide', save);
  app.on('before-quit', save);
  return saveSoon;
}
