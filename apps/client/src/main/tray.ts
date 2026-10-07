import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron';
import { APP_NAME } from '@letopeiras/shared';
import trayIconPath from '../../resources/tray.ico?asset';

let tray: Tray | null = null;

export function showWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Tray icon: click reopens the window, the menu is the only way to really quit. */
export function createTray(win: BrowserWindow, quit: () => void): void {
  tray = new Tray(nativeImage.createFromPath(trayIconPath));
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir LeTopeiras', click: () => showWindow(win) },
      { type: 'separator' },
      { label: 'Sair', click: quit },
    ]),
  );
  tray.on('click', () => showWindow(win));
  app.on('before-quit', () => tray?.destroy());
}
