import { describe, expect, it } from 'vitest';
import {
  BUILTIN_SOUNDS,
  DEFAULT_SOUND_EMOJI,
  SOUNDBOARD_LIMITS,
  soundEmoji,
  soundName,
  validateCustomSound,
} from './soundboard';

describe('validateCustomSound', () => {
  const ok = { bytes: 100_000, seconds: 2, existing: 3 };

  it('accepts a small, short sound', () => {
    expect(validateCustomSound(ok)).toBeNull();
  });

  it('refuses files that are too big, too long or unreadable', () => {
    expect(validateCustomSound({ ...ok, bytes: SOUNDBOARD_LIMITS.maxBytes + 1 })).toMatch(/1 MB/);
    expect(validateCustomSound({ ...ok, seconds: 5.5 })).toMatch(/5 segundos/);
    expect(validateCustomSound({ ...ok, seconds: 0 })).toMatch(/ler/);
    expect(validateCustomSound({ ...ok, seconds: Number.NaN })).toMatch(/ler/);
  });

  it('stops at 20 custom sounds', () => {
    expect(validateCustomSound({ ...ok, existing: 19 })).toBeNull();
    expect(validateCustomSound({ ...ok, existing: 20 })).toMatch(/20 sons/);
  });

  it('allows exactly the limits', () => {
    expect(
      validateCustomSound({ bytes: SOUNDBOARD_LIMITS.maxBytes, seconds: 5, existing: 0 }),
    ).toBeNull();
  });
});

describe('soundName', () => {
  it('drops the extension and tidies the name', () => {
    expect(soundName('  meu   som.mp3 ')).toBe('meu som');
    expect(soundName('a'.repeat(40))).toHaveLength(SOUNDBOARD_LIMITS.nameMax);
  });

  it('never ends up empty', () => {
    expect(soundName('   ')).toBe('Som');
    expect(soundName('.ogg')).toBe('Som');
  });
});

describe('soundEmoji', () => {
  it('keeps a single emoji and falls back to the speaker', () => {
    expect(soundEmoji(' 🎉 ')).toBe('🎉');
    expect(soundEmoji('oi')).toBe(DEFAULT_SOUND_EMOJI);
    expect(soundEmoji('🎉🎉')).toBe(DEFAULT_SOUND_EMOJI);
    expect(soundEmoji('')).toBe(DEFAULT_SOUND_EMOJI);
  });
});

describe('built-in sounds', () => {
  it('are short, unique and look like emoji', () => {
    expect(BUILTIN_SOUNDS).toHaveLength(8);
    expect(new Set(BUILTIN_SOUNDS.map((s) => s.id)).size).toBe(BUILTIN_SOUNDS.length);
    for (const s of BUILTIN_SOUNDS) {
      expect(s.seconds).toBeLessThanOrEqual(SOUNDBOARD_LIMITS.maxSeconds);
      expect(soundEmoji(s.emoji)).toBe(s.emoji);
    }
  });
});
