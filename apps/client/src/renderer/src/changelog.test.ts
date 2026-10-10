import { describe, expect, it } from 'vitest';
import { compareVersions, notesSince } from './changelog';

describe('changelog', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1);
    expect(compareVersions('0.1.6', '0.1.6')).toBe(0);
    expect(compareVersions('0.1.5', '0.2.0')).toBe(-1);
  });

  it('lists the versions after the last one seen, up to the current', () => {
    expect(notesSince('0.1.4', '0.1.6').map((e) => e.version)).toEqual(['0.1.6', '0.1.5']);
    expect(notesSince('0.1.6', '0.1.6')).toEqual([]);
  });
});
