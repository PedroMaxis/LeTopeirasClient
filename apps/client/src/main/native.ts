import { join } from 'node:path';
import { app } from 'electron';

/** Shape of native/audio-capture (src/addon.cc). */
export interface NativeAddon {
  AudioCapture: new (
    options: { pid: number; mode: 'include' | 'exclude' },
    onData: (block: Float32Array) => void,
  ) => { start(): void; stop(): void };
  windowProcessId(hwnd: number): number;
  isKeyDown(vk: number): boolean;
  keyName(vk: number): string;
}

// Packaged builds ship the addon as an extra resource; dev loads it from the workspace.
const addonPath = app.isPackaged
  ? join(process.resourcesPath, 'audio_capture.node')
  : join(app.getAppPath(), '../../native/audio-capture/build/Release/audio_capture.node');

let loaded: { addon: NativeAddon } | { error: string } | undefined;

/** Loads the addon once; both system audio and push-to-talk use it. */
export function loadNativeAddon(): { addon: NativeAddon } | { error: string } {
  if (loaded) return loaded;
  if (process.platform !== 'win32') return (loaded = { error: 'só funciona no Windows' });
  try {
    const module = { exports: {} as NativeAddon };
    process.dlopen(module, addonPath);
    loaded = { addon: module.exports };
  } catch (err) {
    console.warn(`[native] failed to load ${addonPath}:`, err);
    loaded = { error: 'o módulo nativo não carregou' };
  }
  return loaded;
}
