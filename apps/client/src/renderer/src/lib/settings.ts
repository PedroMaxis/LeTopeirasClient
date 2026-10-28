import { z } from 'zod';
import { Store } from './store';

// Per-PC preferences. They don't need to roam between devices, so localStorage is enough.
const KEY = 'letopeiras.settings';

const keybindSchema = z.object({
  vk: z.number().int().min(1).max(254),
  mods: z.array(z.enum(['ctrl', 'shift', 'alt'])).max(3),
  name: z.string(),
});

const settingsSchema = z.object({
  inputDeviceId: z.string().default('default'),
  outputDeviceId: z.string().default('default'),
  videoDeviceId: z.string().default('default'),
  /** Percent; above 100 amplifies. */
  inputVolume: z.number().min(0).max(200).default(100),
  outputVolume: z.number().min(0).max(100).default(100),
  echoCancellation: z.boolean().default(true),
  /** 'browser' is Chromium's built-in filter; 'rnnoise' replaces it with RNNoise (lib/noise.ts). */
  noiseSuppression: z
    // Older versions stored a boolean.
    .preprocess(
      (v) => (typeof v === 'boolean' ? (v ? 'browser' : 'off') : v),
      z.enum(['off', 'browser', 'rnnoise']),
    )
    .default('browser'),
  autoGainControl: z.boolean().default(true),
  showMembers: z.boolean().default(true),
  /** Startup animation (components/Intro.tsx). */
  introAnimation: z.boolean().default(true),
  /** Chat text size in px (lib/appearance.ts). */
  chatFontSize: z.number().int().min(12).max(20).default(15),
  /** Space above each new group of messages, in px. */
  messageSpacing: z.number().int().min(0).max(24).default(14),
  /** One line per message ("14:32 Nome texto"), no avatars. */
  compactMode: z.boolean().default(false),
  /** Red underline and suggestions in text fields (main/context-menu.ts). */
  spellcheck: z.boolean().default(true),
  /** Text chat panel beside the voice stage. */
  voiceChat: z.boolean().default(false),
  /** Voice gate: below this level (dBFS) the mic sends silence. Off = the browser decides. */
  voiceGate: z.boolean().default(false),
  voiceGateThreshold: z.number().min(-100).max(0).default(-50),
  /** Push-to-talk: the mic only sends while `pttKey` is held. Takes precedence over the gate. */
  pushToTalk: z.boolean().default(false),
  pttKey: z
    .object({ vk: z.number().int().min(1).max(254), name: z.string() })
    .nullable()
    .default(null),
  /** Global shortcuts (main/voice-controls.ts), work even with a game focused. */
  muteKey: keybindSchema.nullable().default(null),
  deafenKey: keybindSchema.nullable().default(null),
  /** Subscribe to others' screen shares as soon as they start (otherwise click "Assistir"). */
  autoWatchShares: z.boolean().default(false),
  defaultShareMode: z.enum(['motion', 'detail']).default('motion'),
  defaultShareQuality: z.enum(['720p30', '720p60', '1080p60']).default('1080p60'),
  /** Skip hardware H.265 for screen share even when the GPU offers it (lib/media.ts). */
  preferH264: z.boolean().default(false),
  sounds: z.boolean().default(true),
  notifications: z.boolean().default(true),
  /** false: only notify when someone mentions you. */
  notifyAll: z.boolean().default(true),
  /** Per-channel override of `notifyAll`, keyed by channel id (lib/notify.ts). No entry = follow it. */
  channelNotify: z.record(z.string(), z.enum(['all', 'mentions', 'none'])).default({}),
  /** Local only: no toasts, message sounds or taskbar flashing (others still see you online). */
  doNotDisturb: z.boolean().default(false),
  /** Lower screen share audio and the music while anyone in the room speaks (lib/ducking.ts). */
  ducking: z.boolean().default(true),
  /** Percent to lower by while ducking, 0–80. */
  duckingAmount: z.number().int().min(0).max(80).default(50),
  /** Soundboard volume in percent (0–100), for what we send and what we hear. */
  soundboardVolume: z.number().int().min(0).max(100).default(70),
  /** Volume of the room's music in percent (0–100). The embed can't use the output device setting. */
  musicVolume: z.number().int().min(0).max(100).default(60),
  /** Per-user voice volume in percent (0–200), keyed by user id. */
  userVolumes: z.record(z.string(), z.number().min(0).max(200)).default({}),
  /** Per-user screen share audio volume in percent (0–200), keyed by user id. */
  shareVolumes: z.record(z.string(), z.number().min(0).max(200)).default({}),
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
