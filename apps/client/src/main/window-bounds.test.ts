import { describe, expect, it } from 'vitest';
import { placeWindow, windowStateSchema } from './window-bounds';

const MIN = { width: 940, height: 560 };
const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };
const RIGHT = { x: 1920, y: 0, width: 2560, height: 1400 };

describe('placeWindow', () => {
  it('keeps bounds that are on a screen', () => {
    const saved = { x: 100, y: 50, width: 1280, height: 800 };
    expect(placeWindow(saved, [PRIMARY], MIN)).toEqual(saved);
  });

  it('keeps a window on a second monitor', () => {
    const saved = { x: 2200, y: 100, width: 1600, height: 900 };
    expect(placeWindow(saved, [PRIMARY, RIGHT], MIN)).toEqual(saved);
  });

  it('falls back to the default when the monitor is gone', () => {
    const saved = { x: 2200, y: 100, width: 1600, height: 900 };
    expect(placeWindow(saved, [PRIMARY], MIN)).toBeNull();
  });

  it('falls back when only a sliver is visible', () => {
    const saved = { x: 1880, y: 100, width: 1280, height: 800 };
    expect(placeWindow(saved, [PRIMARY], MIN)).toBeNull();
  });

  it('shrinks to the work area and respects the minimum size', () => {
    expect(placeWindow({ x: 0, y: 0, width: 4000, height: 3000 }, [PRIMARY], MIN)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1040,
    });
    expect(placeWindow({ x: 0, y: 0, width: 300, height: 200 }, [PRIMARY], MIN)).toEqual({
      x: 0,
      y: 0,
      width: 940,
      height: 560,
    });
  });

  it('keeps the title bar below the top of the screen', () => {
    const placed = placeWindow({ x: 100, y: -300, width: 1280, height: 800 }, [PRIMARY], MIN);
    expect(placed?.y).toBe(0);
  });

  it('picks the screen with the biggest overlap', () => {
    // Mostly on the taller right screen, so the height is limited by it, not by the primary.
    const saved = { x: 1700, y: 0, width: 1280, height: 1200 };
    expect(placeWindow(saved, [PRIMARY, RIGHT], MIN)?.height).toBe(1200);
    expect(placeWindow(saved, [PRIMARY], MIN)?.height).toBe(1040);
  });
});

describe('windowStateSchema', () => {
  it('rejects broken files', () => {
    expect(windowStateSchema.safeParse({ x: 1, y: 2 }).success).toBe(false);
    expect(
      windowStateSchema.safeParse({ x: 0, y: 0, width: 0, height: 10, maximized: false }).success,
    ).toBe(false);
  });
});
