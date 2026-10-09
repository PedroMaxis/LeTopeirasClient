import { app, Menu, nativeImage, Tray, type BrowserWindow, type NativeImage } from 'electron';
import { APP_NAME } from '@letopeiras/shared';
import trayIconPath from '../../resources/tray.ico?asset';
import { IpcChannel, type TrayVoiceState, type VoiceAction } from '../shared/ipc';

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let quitApp: () => void = () => undefined;
let icons: { idle: NativeImage; voice: NativeImage; muted: NativeImage } | null = null;
let voice: TrayVoiceState = { inVoice: false, muted: false, deafened: false };

export function showWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

const ICON_SIZE = 32;

/**
 * The tray icon with a status dot in the bottom-right corner, drawn into the bitmap (BGRA on
 * Windows) so no extra icon files are needed.
 */
function withDot(base: NativeImage, [r, g, b]: [number, number, number]): NativeImage {
  const pixels = Buffer.from(base.toBitmap());
  const radius = 7;
  const center = ICON_SIZE - radius - 1;
  for (let y = 0; y < ICON_SIZE; y++) {
    for (let x = 0; x < ICON_SIZE; x++) {
      const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center);
      if (distance > radius) continue;
      // A dark ring keeps the dot readable over the logo and light taskbars.
      const ring = distance > radius - 1.5;
      const i = (y * ICON_SIZE + x) * 4;
      pixels[i] = ring ? 0x0a : b;
      pixels[i + 1] = ring ? 0x0d : g;
      pixels[i + 2] = ring ? 0x12 : r;
      pixels[i + 3] = 0xff;
    }
  }
  return nativeImage.createFromBitmap(pixels, {
    width: ICON_SIZE,
    height: ICON_SIZE,
    scaleFactor: 2,
  });
}

function loadIcons(): NonNullable<typeof icons> {
  const base = nativeImage
    .createFromPath(trayIconPath)
    .resize({ width: ICON_SIZE, height: ICON_SIZE, quality: 'best' });
  // --speaking and --danger from design/DESIGN.md.
  return {
    idle: base,
    voice: withDot(base, [0x3f, 0xb5, 0x6b]),
    muted: withDot(base, [0xd9, 0x41, 0x2f]),
  };
}

function send(action: VoiceAction): void {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send(IpcChannel.VoiceAction, action);
}

function render(): void {
  if (!tray || !mainWindow || !icons) return;
  const win = mainWindow;
  const silenced = voice.muted || voice.deafened;
  tray.setImage(!voice.inVoice ? icons.idle : silenced ? icons.muted : icons.voice);
  tray.setToolTip(
    !voice.inVoice
      ? APP_NAME
      : `${APP_NAME} — em voz${voice.deafened ? ' (ensurdecido)' : voice.muted ? ' (mutado)' : ''}`,
  );
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir LeTopeiras', click: () => showWindow(win) },
      { type: 'separator' },
      // Unmuting while deafened also undeafens, so the mute check follows what you hear.
      { label: 'Mutar', type: 'checkbox', checked: silenced, click: () => send('toggleMute') },
      {
        label: 'Ensurdecer',
        type: 'checkbox',
        checked: voice.deafened,
        click: () => send('toggleDeafen'),
      },
      { label: 'Desconectar', enabled: voice.inVoice, click: () => send('leave') },
      { type: 'separator' },
      { label: 'Sair', click: quitApp },
    ]),
  );
}

/** Tray icon: click reopens the window, the menu is the only way to really quit. */
export function createTray(win: BrowserWindow, quit: () => void): void {
  mainWindow = win;
  quitApp = quit;
  icons = loadIcons();
  tray = new Tray(icons.idle);
  render();
  tray.on('click', () => showWindow(win));
  app.on('before-quit', () => tray?.destroy());
}

/** Voice state from the renderer: menu checkmarks and the icon's dot. */
export function updateTrayVoice(state: TrayVoiceState): void {
  voice = state;
  render();
}
