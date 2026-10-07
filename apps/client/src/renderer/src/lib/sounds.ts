import { settings } from './settings';

// Short UI sounds synthesized with Web Audio (no audio files to ship), in the spirit of
// Discord's: soft, rounded "bloops" that glide up when something starts or someone
// arrives, and down when it ends or someone leaves.

interface Note {
  /** Starting pitch, Hz. */
  freq: number;
  /** Where the pitch glides to over the note, Hz (omit for a steady note). */
  to?: number;
  /** Offset from the start of the sound, seconds. */
  at: number;
  /** Time until the note fades out, seconds. */
  dur: number;
  /** Relative loudness, 1 = normal. */
  gain?: number;
  /** "bloop": round, almost pure (voice events). "bell": brighter, with partials (alerts). */
  tone?: 'bloop' | 'bell';
}

// Partials as [frequency multiple, relative amplitude, decay speed multiple].
const TIMBRES: Record<NonNullable<Note['tone']>, [number, number, number][]> = {
  bloop: [
    [1, 1, 1],
    [2, 0.12, 1.8],
  ],
  bell: [
    [1, 1, 1],
    [2, 0.32, 1.6],
    [3.01, 0.14, 2.4],
    [4.2, 0.05, 3.2],
  ],
};

const SOUNDS = {
  /** We joined a voice channel: two quick rising bloops. */
  join: [
    { freq: 520, to: 600, at: 0, dur: 0.12 },
    { freq: 760, to: 880, at: 0.085, dur: 0.2 },
  ],
  /** We left: the same, falling. */
  leave: [
    { freq: 880, to: 760, at: 0, dur: 0.12 },
    { freq: 600, to: 470, at: 0.085, dur: 0.22 },
  ],
  /** Someone joined our channel: one bright upward bloop. */
  userJoin: [{ freq: 640, to: 980, at: 0, dur: 0.18, gain: 0.85 }],
  /** Someone left it: one downward bloop. */
  userLeave: [{ freq: 900, to: 560, at: 0, dur: 0.18, gain: 0.85 }],
  /** Short low "tock" sliding down. */
  mute: [{ freq: 520, to: 360, at: 0, dur: 0.09 }],
  /** And sliding up. */
  unmute: [{ freq: 380, to: 560, at: 0, dur: 0.09 }],
  /** Two lower notes going down. */
  deafen: [
    { freq: 560, to: 500, at: 0, dur: 0.09 },
    { freq: 400, to: 300, at: 0.07, dur: 0.14 },
  ],
  undeafen: [
    { freq: 320, to: 400, at: 0, dur: 0.09 },
    { freq: 500, to: 580, at: 0.07, dur: 0.14 },
  ],
  /** Someone (or we) started a screen share: three rising notes. */
  streamStart: [
    { freq: 523, at: 0, dur: 0.1, tone: 'bell', gain: 0.7 },
    { freq: 659, at: 0.075, dur: 0.1, tone: 'bell', gain: 0.7 },
    { freq: 988, at: 0.15, dur: 0.26, tone: 'bell', gain: 0.75 },
  ],
  /** A screen share ended: three falling notes. */
  streamStop: [
    { freq: 988, at: 0, dur: 0.1, tone: 'bell', gain: 0.7 },
    { freq: 659, at: 0.075, dur: 0.1, tone: 'bell', gain: 0.7 },
    { freq: 494, at: 0.15, dur: 0.24, tone: 'bell', gain: 0.75 },
  ],
  /** New message notification: a light two-tone ping. */
  message: [
    { freq: 1175, at: 0, dur: 0.12, tone: 'bell', gain: 0.65 },
    { freq: 1568, at: 0.07, dur: 0.3, tone: 'bell', gain: 0.6 },
  ],
  /** The voice connection dropped for good. */
  disconnect: [
    { freq: 660, to: 560, at: 0, dur: 0.12 },
    { freq: 520, to: 420, at: 0.1, dur: 0.12 },
    { freq: 400, to: 260, at: 0.2, dur: 0.3 },
  ],
} satisfies Record<string, Note[]>;

export type SoundName = keyof typeof SOUNDS;

/** Overall loudness at 100 % output volume; UI sounds sit well under voices. */
const BASE_VOLUME = 0.22;

let context: AudioContext | null = null;
let sinkId: string | null = null;

async function getContext(): Promise<AudioContext> {
  context ??= new AudioContext({ latencyHint: 'interactive' });
  const wanted = settings.get().outputDeviceId;
  if (wanted !== sinkId) {
    sinkId = wanted;
    // Same output device as the voices (Chromium supports AudioContext.setSinkId).
    const ctx = context as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    await ctx.setSinkId?.(wanted === 'default' ? '' : wanted).catch(() => undefined);
  }
  if (context.state === 'suspended') await context.resume();
  return context;
}

function playNote(
  ctx: AudioContext,
  out: AudioNode,
  note: Note,
  start: number,
  volume: number,
): void {
  const at = start + note.at;
  const end = at + note.dur;
  for (const [multiple, amplitude, decay] of TIMBRES[note.tone ?? 'bloop']) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(note.freq * multiple, at);
    if (note.to) {
      // Exponential glide sounds natural to the ear (constant musical speed).
      osc.frequency.exponentialRampToValueAtTime(note.to * multiple, at + note.dur * 0.7);
    }
    const peak = volume * (note.gain ?? 1) * amplitude;
    const partialEnd = at + note.dur / decay;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(peak, at + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, Math.max(partialEnd, at + 0.02));
    osc.connect(env).connect(out);
    osc.start(at);
    osc.stop(end + 0.05);
  }
}

/** Plays a UI sound unless sounds are turned off. `force` plays it anyway (settings preview). */
export function playSound(name: SoundName, force = false): void {
  if (!force && !settings.get().sounds) return;
  void getContext()
    .then((ctx) => {
      // A gentle low-pass takes the digital edge off the harmonics.
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 4200;
      filter.Q.value = 0.5;
      filter.connect(ctx.destination);

      const volume = (settings.get().outputVolume / 100) * BASE_VOLUME;
      const start = ctx.currentTime + 0.01;
      const notes: Note[] = SOUNDS[name];
      for (const note of notes) playNote(ctx, filter, note, start, volume);
      const length = Math.max(...notes.map((n) => n.at + n.dur));
      setTimeout(() => filter.disconnect(), (length + 0.3) * 1000);
    })
    .catch(() => undefined);
}
