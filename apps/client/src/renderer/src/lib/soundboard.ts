import { isReactionEmoji } from '@letopeiras/shared';

/** What a custom sound must respect (the file is kept in IndexedDB on this PC). */
export const SOUNDBOARD_LIMITS = {
  customSounds: 20,
  maxBytes: 1024 * 1024,
  maxSeconds: 5,
  nameMax: 24,
} as const;

export const DEFAULT_SOUND_EMOJI = '🔊';

/** Why a file can't be a custom sound, in PT-BR, or null when it can. */
export function validateCustomSound(file: {
  bytes: number;
  seconds: number;
  existing: number;
}): string | null {
  if (file.existing >= SOUNDBOARD_LIMITS.customSounds) {
    return `Você já tem ${SOUNDBOARD_LIMITS.customSounds} sons. Remova um para adicionar outro.`;
  }
  if (file.bytes > SOUNDBOARD_LIMITS.maxBytes) return 'O arquivo passa de 1 MB.';
  if (file.seconds > SOUNDBOARD_LIMITS.maxSeconds) {
    return `O som passa de ${SOUNDBOARD_LIMITS.maxSeconds} segundos.`;
  }
  if (!(file.seconds > 0)) return 'Não deu para ler esse áudio.';
  return null;
}

/** A tidy name (trimmed, one line, at most 24 characters); the file's name without its extension. */
export function soundName(raw: string): string {
  const clean = raw
    .trim()
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.slice(0, SOUNDBOARD_LIMITS.nameMax) || 'Som';
}

/** The emoji if it is exactly one, else the default speaker. */
export const soundEmoji = (raw: string): string =>
  isReactionEmoji(raw.trim()) ? raw.trim() : DEFAULT_SOUND_EMOJI;

// ---------------------------------------------------------------------------
// Built-in sounds, synthesized (like lib/sounds.ts) so the app ships no audio files.

const SAMPLE_RATE = 48_000;

interface Tone {
  type?: OscillatorType;
  freq: number;
  /** The pitch glides to this over the tone. */
  to?: number;
  at: number;
  dur: number;
  gain?: number;
  /** Seconds to fade in; the rest of `dur` fades out. */
  attack?: number;
}

function tone(ctx: OfflineAudioContext, t: Tone): void {
  const osc = ctx.createOscillator();
  osc.type = t.type ?? 'sine';
  osc.frequency.setValueAtTime(t.freq, t.at);
  if (t.to !== undefined) osc.frequency.exponentialRampToValueAtTime(t.to, t.at + t.dur);
  const gain = ctx.createGain();
  const peak = t.gain ?? 0.4;
  const attack = t.attack ?? 0.01;
  gain.gain.setValueAtTime(0.0001, t.at);
  gain.gain.exponentialRampToValueAtTime(peak, t.at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t.at + t.dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t.at);
  osc.stop(t.at + t.dur + 0.02);
}

function noise(ctx: OfflineAudioContext, at: number, dur: number, gain: number): void {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 5000;
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, at);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  source.connect(filter).connect(env).connect(ctx.destination);
  source.start(at);
}

export interface BuiltinSound {
  id: string;
  name: string;
  emoji: string;
  seconds: number;
  render(ctx: OfflineAudioContext): void;
}

export const BUILTIN_SOUNDS: readonly BuiltinSound[] = [
  {
    id: 'airhorn',
    name: 'Buzina',
    emoji: '📯',
    seconds: 1.1,
    render: (ctx) => {
      for (const freq of [349, 440, 523]) {
        tone(ctx, { type: 'sawtooth', freq, at: 0, dur: 0.5, gain: 0.12, attack: 0.02 });
        tone(ctx, { type: 'sawtooth', freq, at: 0.55, dur: 0.5, gain: 0.12, attack: 0.02 });
      }
    },
  },
  {
    id: 'sad-trombone',
    name: 'Que pena',
    emoji: '🎺',
    seconds: 1.8,
    render: (ctx) => {
      const notes: [number, number, number][] = [
        [233, 0, 0.4],
        [220, 0.4, 0.4],
        [208, 0.8, 0.4],
        [196, 1.2, 0.6],
      ];
      for (const [freq, at, dur] of notes) {
        tone(ctx, { type: 'sawtooth', freq, to: freq * 0.96, at, dur, gain: 0.2, attack: 0.04 });
      }
    },
  },
  {
    id: 'rimshot',
    name: 'Ba dum tss',
    emoji: '🥁',
    seconds: 1.1,
    render: (ctx) => {
      tone(ctx, { freq: 160, to: 55, at: 0, dur: 0.15, gain: 0.7 });
      tone(ctx, { freq: 200, to: 70, at: 0.18, dur: 0.15, gain: 0.7 });
      noise(ctx, 0.42, 0.65, 0.6);
    },
  },
  {
    id: 'laser',
    name: 'Laser',
    emoji: '🔫',
    seconds: 0.4,
    render: (ctx) =>
      tone(ctx, { type: 'square', freq: 1900, to: 180, at: 0, dur: 0.3, gain: 0.15 }),
  },
  {
    id: 'boing',
    name: 'Boing',
    emoji: '🪀',
    seconds: 0.7,
    render: (ctx) => {
      tone(ctx, { freq: 180, to: 620, at: 0, dur: 0.18, gain: 0.5 });
      tone(ctx, { freq: 620, to: 140, at: 0.18, dur: 0.4, gain: 0.5 });
    },
  },
  {
    id: 'ding',
    name: 'Ding',
    emoji: '🔔',
    seconds: 1.3,
    render: (ctx) => {
      tone(ctx, { freq: 1320, at: 0, dur: 1.2, gain: 0.4 });
      tone(ctx, { freq: 2640, at: 0, dur: 0.8, gain: 0.12 });
      tone(ctx, { freq: 3970, at: 0, dur: 0.4, gain: 0.05 });
    },
  },
  {
    id: 'buzzer',
    name: 'Errou',
    emoji: '❌',
    seconds: 0.8,
    render: (ctx) => {
      tone(ctx, { type: 'square', freq: 120, at: 0, dur: 0.7, gain: 0.18, attack: 0.02 });
      tone(ctx, { type: 'square', freq: 127, at: 0, dur: 0.7, gain: 0.18, attack: 0.02 });
    },
  },
  {
    id: 'fanfare',
    name: 'Tchan',
    emoji: '🎉',
    seconds: 1.3,
    render: (ctx) => {
      const arpeggio = [523, 659, 784];
      arpeggio.forEach((freq, i) =>
        tone(ctx, { type: 'triangle', freq, at: i * 0.1, dur: 0.18, gain: 0.3 }),
      );
      for (const freq of [523, 659, 784, 1047]) {
        tone(ctx, { type: 'triangle', freq, at: 0.3, dur: 0.9, gain: 0.22, attack: 0.02 });
      }
    },
  },
];

const rendered = new Map<string, Promise<AudioBuffer>>();

/** The built-in sound as a buffer, rendered offline once. */
export function builtinBuffer(sound: BuiltinSound): Promise<AudioBuffer> {
  let buffer = rendered.get(sound.id);
  if (!buffer) {
    const ctx = new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * sound.seconds), SAMPLE_RATE);
    sound.render(ctx);
    buffer = ctx.startRendering();
    rendered.set(sound.id, buffer);
  }
  return buffer;
}

/** Decodes an uploaded audio file. `bytes` is copied, since decoding detaches its buffer. */
export function decodeSound(bytes: ArrayBuffer): Promise<AudioBuffer> {
  return new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(bytes.slice(0));
}
