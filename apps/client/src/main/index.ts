import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, nativeImage, powerMonitor, session, shell } from 'electron';
import { APP_ID } from '@letopeiras/shared';
import windowIconPath from '../../resources/tray.ico?asset';
import { IpcChannel, type AppInfo } from '../shared/ipc';
import { attachContextMenu, registerSpellcheck } from './context-menu';
import { registerDiagnostics, startCrashReporter } from './diagnostics';
import { configurePermissions } from './permissions';
import { assertTrustedSender, rendererDevUrl, rendererFile } from './renderer';
import { registerPushToTalk } from './push-to-talk';
import { registerScreenCapture } from './screen-capture';
import { registerSessionStore } from './session-store';
import { registerSystemAudio } from './system-audio';
import { createTray, showWindow } from './tray';
import { registerVoiceControls } from './voice-controls';
import { registerUpdater } from './updater';
import { registerVoiceResume } from './voice-resume';
import { restoreWindowState, trackWindowState } from './window-state';

// Remote voices must play as soon as they arrive, without waiting for a click.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

startCrashReporter();

/** Passed when Windows starts the app at login: stay in the tray instead of popping up. */
const HIDDEN_ARG = '--hidden';
/** The taskbar badge the renderer draws: a small PNG, nothing else. */
const BADGE_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]{1,40000}$/;
const startHidden = process.argv.includes(HIDDEN_ARG);

/** Set when the user picks "Sair" in the tray; otherwise closing only hides the window. */
let quitting = false;

function registerIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IpcChannel.GetAppInfo, (event): AppInfo => {
    assertTrustedSender(event);
    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    };
  });

  ipcMain.handle(IpcChannel.WindowMinimize, (event) => {
    assertTrustedSender(event);
    getWindow()?.minimize();
  });
  ipcMain.handle(IpcChannel.WindowToggleMaximize, (event) => {
    assertTrustedSender(event);
    const win = getWindow();
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });
  ipcMain.handle(IpcChannel.WindowClose, (event) => {
    assertTrustedSender(event);
    getWindow()?.hide();
  });
  ipcMain.handle(IpcChannel.WindowShow, (event) => {
    assertTrustedSender(event);
    const win = getWindow();
    if (win) showWindow(win);
  });

  ipcMain.handle(IpcChannel.WindowSetBadge, (event, rawUrl: unknown, rawDescription: unknown) => {
    assertTrustedSender(event);
    const win = getWindow();
    if (!win) return;
    const url = typeof rawUrl === 'string' && BADGE_URL.test(rawUrl) ? rawUrl : null;
    const description = typeof rawDescription === 'string' ? rawDescription.slice(0, 100) : '';
    win.setOverlayIcon(url ? nativeImage.createFromDataURL(url) : null, description);
  });
  ipcMain.handle(IpcChannel.WindowFlash, (event) => {
    assertTrustedSender(event);
    const win = getWindow();
    if (win && !win.isFocused()) win.flashFrame(true);
  });

  ipcMain.handle(IpcChannel.GetIdleSeconds, (event) => {
    assertTrustedSender(event);
    return powerMonitor.getSystemIdleTime();
  });

  ipcMain.handle(IpcChannel.GetLaunchAtLogin, (event) => {
    assertTrustedSender(event);
    return app.getLoginItemSettings({ args: [HIDDEN_ARG] }).openAtLogin;
  });
  ipcMain.handle(IpcChannel.SetLaunchAtLogin, (event, enabled: unknown) => {
    assertTrustedSender(event);
    app.setLoginItemSettings({ openAtLogin: enabled === true, args: [HIDDEN_ARG] });
  });
}

const MIN_SIZE = { width: 940, height: 560 };

function createMainWindow(): BrowserWindow {
  const saved = restoreWindowState(MIN_SIZE);
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    ...saved.bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    // The title bar is drawn by the renderer (see TitleBar.tsx).
    frame: false,
    backgroundColor: '#16100c',
    icon: windowIconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Voice and screen share must keep running while the window is hidden or minimized.
      backgroundThrottling: false,
    },
  });

  win.once('ready-to-show', () => {
    // maximize() also shows the window, so a hidden start waits for the first show.
    if (startHidden) {
      if (saved.maximized) win.once('show', () => win.maximize());
      return;
    }
    if (saved.maximized) win.maximize();
    win.show();
  });
  trackWindowState(win);
  attachContextMenu(win);
  // A mention flashed the taskbar button; looking at the window is enough.
  win.on('focus', () => win.flashFrame(false));
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });

  // External links open in the default browser; the app never spawns extra windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = rendererDevUrl ? url.startsWith(rendererDevUrl) : false;
    if (!allowed) event.preventDefault();
  });

  if (rendererDevUrl) {
    void win.loadURL(rendererDevUrl);
  } else {
    void win.loadFile(rendererFile);
  }

  return win;
}

// Windows caches the taskbar icon per AppUserModelID. In dev the process is electron.exe,
// so sharing the installed app's ID would make its taskbar button show Electron's icon.
app.setAppUserModelId(app.isPackaged ? APP_ID : `${APP_ID}.dev`);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;

  app.on('second-instance', () => {
    if (mainWindow) showWindow(mainWindow);
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  void app.whenReady().then(() => {
    registerDiagnostics(() => mainWindow);
    configurePermissions(session.defaultSession);
    registerScreenCapture(session.defaultSession);
    registerSessionStore();
    registerSystemAudio();
    registerPushToTalk();
    registerVoiceControls();
    registerVoiceResume();
    registerSpellcheck();
    registerIpc(() => mainWindow);
    mainWindow = createMainWindow();
    createTray(mainWindow, () => app.quit());
    registerUpdater(() => mainWindow);
  });

  app.on('window-all-closed', () => app.quit());
}
