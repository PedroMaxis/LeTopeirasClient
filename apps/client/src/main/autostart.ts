import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
import { APP_NAME } from '@letopeiras/shared';

const desktopFile = () =>
  join(
    process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'),
    'autostart',
    'letopeiras-client.desktop',
  );

/** Quotes one argument of a .desktop Exec line. */
const quote = (arg: string) => `"${arg.replace(/(["`$\\])/g, '\\$1')}"`;

/** "Iniciar com o sistema": a login item on Windows, an XDG autostart entry on Linux. */
export function getLaunchAtLogin(hiddenArg: string): boolean {
  if (process.platform === 'linux') return existsSync(desktopFile());
  return app.getLoginItemSettings({ args: [hiddenArg] }).openAtLogin;
}

export function setLaunchAtLogin(enabled: boolean, hiddenArg: string): void {
  if (process.platform !== 'linux') {
    app.setLoginItemSettings({ openAtLogin: enabled, args: [hiddenArg] });
    return;
  }
  const file = desktopFile();
  if (!enabled) {
    rmSync(file, { force: true });
    return;
  }
  // An AppImage moves around; $APPIMAGE is the file the user actually launched.
  const exec = process.env['APPIMAGE'] ?? process.execPath;
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(
    file,
    [
      '[Desktop Entry]',
      'Type=Application',
      `Name=${APP_NAME}`,
      `Exec=${quote(exec)} ${hiddenArg}`,
      'X-GNOME-Autostart-enabled=true',
      '',
    ].join('\n'),
  );
}
