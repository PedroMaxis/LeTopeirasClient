import { z } from 'zod';
import { Store } from './store';

// Per-PC preferences. They don't need to roam between devices, so localStorage is enough.
const KEY = 'letopeiras.settings';

const settingsSchema = z.object({
  inputDeviceId: z.string().default('default'),
  outputDeviceId: z.string().default('default'),
  /** Percent; above 100 amplifies. */
  inputVolume: z.number().min(0).max(200).default(100),
  outputVolume: z.number().min(0).max(100).default(100),
  echoCancellation: z.boolean().default(true),
  noiseSuppression: z.boolean().default(true),
  autoGainControl: z.boolean().default(true),
  showMembers: z.boolean().default(true),
  /** Voice gate: below this level (dBFS) the mic sends silence. Off = the browser decides. */
  voiceGate: z.boolean().default(false),
  voiceGateThreshold: z.number().min(-100).max(0).default(-50),
  defaultShareMode: z.enum(['motion', 'detail']).default('motion'),
  defaultShareQuality: z.enum(['720p30', '720p60', '1080p60']).default('1080p60'),
  sounds: z.boolean().default(true),
  notifications: z.boolean().default(true),
  /** false: only notify when someone mentions you. */
  notifyAll: z.boolean().default(true),
  /** Per-user voice volume in percent (0–200), keyed by user id. */
  userVolumes: z.record(z.string(), z.number().min(0).max(200)).default({}),
});
export type Settings = z.infer<typeof settingsSchema>;

function load(): Settings {
  try {
    return settingsSchema.parse(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return settingsSchema.parse({});
  }
}

export const settings = new Store<Settings>(load());

settings.subscribe(() => localStorage.setItem(KEY, JSON.stringify(settings.get())));

export function updateSettings(patch: Partial<Settings>): void {
  settings.set(patch);
}
