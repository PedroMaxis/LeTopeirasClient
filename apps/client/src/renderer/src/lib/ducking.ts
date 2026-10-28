/** Time constants (s) for the share bus: ~100 ms to go down, ~600 ms to come back. */
export const DUCK_ATTACK_TC = 0.033;
export const DUCK_RELEASE_TC = 0.2;
/** The music ramps in steps this far apart: all the way down in one, back up in six. */
export const MUSIC_DUCK_STEP_MS = 100;
const MUSIC_RELEASE_STEPS = 6;

/** Gain factor while ducked: `amount` is the percent to lower by (0–80). */
export const duckFactor = (amount: number): number => 1 - Math.min(80, Math.max(0, amount)) / 100;

/** What the shares and the music are scaled by now: 1 when not ducking or nobody speaks. */
export function duckTarget(enabled: boolean, someoneSpeaking: boolean, amount: number): number {
  return enabled && someoneSpeaking ? duckFactor(amount) : 1;
}

/**
 * One 100 ms step of the music's duck factor toward `target`: down at once, up gradually
 * (so the song doesn't jump back the moment a word ends).
 */
export function stepDuck(current: number, target: number, amount: number): number {
  if (target < current) return target;
  const up = Math.max(0.05, amount / 100 / MUSIC_RELEASE_STEPS);
  return Math.min(target, current + up);
}
