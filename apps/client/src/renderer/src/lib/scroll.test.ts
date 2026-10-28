import { describe, expect, it } from 'vitest';
import { anchorAt, scrollDeltaToAnchor } from './scroll';

const items = [
  { id: 10, top: -120, bottom: -60 },
  { id: 11, top: -60, bottom: 20 },
  { id: 12, top: 20, bottom: 90 },
];

describe('anchorAt', () => {
  it('picks the first message that reaches into view, with its offset', () => {
    expect(anchorAt(items, 0)).toEqual({ messageId: 11, offset: -60 });
  });

  it('is relative to the top of the list', () => {
    expect(anchorAt(items, -100)).toEqual({ messageId: 10, offset: -20 });
  });

  it('returns null when nothing is in view', () => {
    expect(anchorAt(items, 500)).toBeNull();
    expect(anchorAt([], 0)).toBeNull();
  });

  it('does not count a message that ends exactly at the top', () => {
    expect(
      anchorAt(
        [
          { id: 1, top: -50, bottom: 0 },
          { id: 2, top: 0, bottom: 40 },
        ],
        0,
      )?.messageId,
    ).toBe(2);
  });
});

describe('scrollDeltaToAnchor', () => {
  it('moves the anchor back to where it was', () => {
    const anchor = { messageId: 11, offset: -60 };
    // After reopening it sits 300 px below the top; we want it 60 px above.
    expect(scrollDeltaToAnchor(300, 0, anchor)).toBe(360);
    // Already in place: no scrolling.
    expect(scrollDeltaToAnchor(-60, 0, anchor)).toBe(0);
  });
});
