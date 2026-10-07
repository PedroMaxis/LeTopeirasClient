// IPC channel names and payload types shared by main, preload and renderer.

export const IpcChannel = {
  GetAppInfo: 'app:get-info',
  GetScreenSources: 'screen:get-sources',
  SelectScreenSource: 'screen:select-source',
  WindowMinimize: 'window:minimize',
  WindowToggleMaximize: 'window:toggle-maximize',
  WindowClose: 'window:close',
  WindowShow: 'window:show',
  GetIdleSeconds: 'system:idle-seconds',
  GetLaunchAtLogin: 'app:get-launch-at-login',
  SetLaunchAtLogin: 'app:set-launch-at-login',
  SessionLoad: 'session:load',
  SessionSave: 'session:save',
  SessionClear: 'session:clear',
  SystemAudioStatus: 'system-audio:status',
  SystemAudioStart: 'system-audio:start',
  SystemAudioStop: 'system-audio:stop',
  /** main → renderer: carries the MessagePort with the PCM blocks. */
  SystemAudioPort: 'system-audio:port',
} as const;

/** `window.postMessage` tag the preload uses to hand the PCM port to the page. */
export const SYSTEM_AUDIO_PORT_MESSAGE = 'letopeiras:system-audio-port';

export type SystemAudioStatus = { available: true } | { available: false; reason: string };

export type SystemAudioStart =
  { ok: true; mode: 'include' | 'exclude' } | { ok: false; reason: string };

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
}

export interface ScreenSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  /** PNG data URL. */
  thumbnail: string;
  /** PNG data URL of the owning app's icon (windows only). */
  appIcon: string | null;
}

export interface LeTopeirasApi {
  getAppInfo(): Promise<AppInfo>;
  getScreenSources(): Promise<ScreenSource[]>;
  /**
   * Picks the source that the next `getDisplayMedia()` call from this window will
   * capture. The selection expires if unused.
   */
  selectScreenSource(sourceId: string): Promise<void>;

  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  /** Hides the window to the tray; the app keeps running. */
  closeWindow(): Promise<void>;
  /** Brings the window back from the tray (e.g. clicking a notification). */
  showWindow(): Promise<void>;
  /** Seconds since the last keyboard/mouse input anywhere on the PC. */
  getIdleSeconds(): Promise<number>;
  /** "Iniciar com o Windows" (starts hidden in the tray). */
  getLaunchAtLogin(): Promise<boolean>;
  setLaunchAtLogin(enabled: boolean): Promise<void>;

  /** The session token saved with "Manter conectado", or null. Encrypted with safeStorage. */
  loadSession(): Promise<string | null>;
  saveSession(token: string): Promise<void>;
  clearSession(): Promise<void>;

  /** Whether the native loopback addon loaded. */
  getSystemAudioStatus(): Promise<SystemAudioStatus>;
  /**
   * Starts capturing the audio that goes with a screen share source. On success the PCM port
   * arrives as a `window` message tagged SYSTEM_AUDIO_PORT_MESSAGE.
   */
  startSystemAudio(sourceId: string): Promise<SystemAudioStart>;
  stopSystemAudio(): Promise<void>;
}
