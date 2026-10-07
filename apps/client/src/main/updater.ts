import { app, ipcMain, type BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import { IpcChannel } from '../shared/ipc';
import { assertTrustedSender } from './renderer';

const { autoUpdater } = electronUpdater;

/** The app lives in the tray for days, so look for new releases periodically too. */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * Auto-update from GitHub Releases (feed configured by `publish` in electron-builder.yml).
 * Updates download in the background; the renderer offers "Reiniciar" once one is ready,
 * and otherwise it installs the next time the app quits.
 */
export function registerUpdater(getWindow: () => BrowserWindow | null): void {
  let readyVersion: string | null = null;

  ipcMain.handle(IpcChannel.UpdateGetReady, (event) => {
    assertTrustedSender(event);
    return readyVersion;
  });
  ipcMain.handle(IpcChannel.UpdateInstall, (event) => {
    assertTrustedSender(event);
    if (readyVersion) autoUpdater.quitAndInstall(true, true);
  });

  // Dev runs have no app-update.yml and nothing to update.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (err) => console.warn('Auto-update failed:', err.message));
  autoUpdater.on('update-downloaded', (info) => {
    readyVersion = info.version;
    getWindow()?.webContents.send(IpcChannel.UpdateReady, info.version);
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch((err: unknown) => {
      console.warn('Update check failed:', err instanceof Error ? err.message : err);
    });
  };
  check();
  setInterval(check, CHECK_INTERVAL_MS).unref();
}
