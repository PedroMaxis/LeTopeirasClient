import { describe, expect, it } from 'vitest';
import { duckFactor, duckTarget, stepDuck } from './ducking';

describe('duckTarget', () => {
  it('lowers by the chosen amount only while someone speaks', () => {
    expect(duckTarget(true, true, 50)).toBe(0.5);
    expect(duckTarget(true, false, 50)).toBe(1);
    expect(duckTarget(false, true, 50)).toBe(1);
  });

  it('keeps the amount within 0–80 %', () => {
    expect(duckFactor(100)).toBeCloseTo(0.2);
    expect(duckFactor(-10)).toBe(1);
    expect(duckFactor(0)).toBe(1);
  });
});

describe('stepDuck', () => {
  it('goes down at once', () => {
    expect(stepDuck(1, 0.5, 50)).toBe(0.5);
  });

  it('comes back up gradually and stops at 1', () => {
    let factor = 0.5;
    const seen: number[] = [];
    for (let i = 0; i < 10 && factor < 1; i++) {
      factor = stepDuck(factor, 1, 50);
      seen.push(factor);
    }
    expect(seen.length).toBeGreaterThan(3);
    expect(seen[0]).toBeGreaterThan(0.5);
    expect(seen.at(-1)).toBe(1);
    expect(Math.max(...seen)).toBe(1);
  });

  it('stays put at the target', () => {
    expect(stepDuck(0.5, 0.5, 50)).toBe(0.5);
    expect(stepDuck(1, 1, 50)).toBe(1);
  });
});
