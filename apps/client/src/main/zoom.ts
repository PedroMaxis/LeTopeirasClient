import { ipcMain, type BrowserWindow } from 'electron';
import { IpcChannel } from '../shared/ipc';
import { assertTrustedSender } from './renderer';
import { stepZoom } from './window-bounds';

/**
 * Page zoom for the main window: Ctrl+= / Ctrl++ / Ctrl+Numpad+ zoom in, Ctrl+- out and Ctrl+0
 * resets, on Chromium's steps. The mouse wheel with Ctrl arrives as `zoom-changed`; pinch zoom is
 * off. The factor is reapplied after every load (a crash reload keeps it) and saved by the caller.
 */
export function attachZoom(win: BrowserWindow, initial: number, onChange: () => void): void {
  const { webContents } = win;
  const set = (factor: number) => {
    webContents.setZoomFactor(factor);
    if (!win.isDestroyed()) webContents.send(IpcChannel.ZoomChanged, webContents.getZoomFactor());
    onChange();
  };

  void webContents.setVisualZoomLevelLimits(1, 1);
  webContents.on('did-finish-load', () => webContents.setZoomFactor(initial));

  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control || input.alt) return;
    const current = webContents.getZoomFactor();
    if (input.key === '=' || input.key === '+') set(stepZoom(current, 1));
    else if (input.key === '-' || input.key === '_') set(stepZoom(current, -1));
    else if (input.key === '0') set(1);
    else return;
    event.preventDefault();
  });

  webContents.on('zoom-changed', (_event, direction) => {
    set(stepZoom(webContents.getZoomFactor(), direction === 'in' ? 1 : -1));
  });

  ipcMain.handle(IpcChannel.ZoomGet, (event) => {
    assertTrustedSender(event);
    return webContents.getZoomFactor();
  });
  ipcMain.handle(IpcChannel.ZoomReset, (event) => {
    assertTrustedSender(event);
    set(1);
  });
}
