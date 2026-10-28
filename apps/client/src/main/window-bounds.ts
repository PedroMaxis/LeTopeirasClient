import { z } from 'zod';

// Pure helpers for window-state.ts (no Electron here, so they can be unit tested).

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const windowStateSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  maximized: z.boolean(),
  /** Page zoom factor (Ctrl+= / Ctrl+-); files saved before it existed read as 1. */
  zoom: z.number().min(0.5).max(2).default(1),
});
export type WindowState = z.infer<typeof windowStateSchema>;

/** The zoom factors Ctrl+= / Ctrl+- walk through (Chromium's own steps). */
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

/** The next step above (`1`) or below (`-1`) `current`, staying at the end of the list. */
export function stepZoom(current: number, direction: 1 | -1): number {
  const eps = 0.001;
  const first = ZOOM_STEPS[0];
  const last = ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? 1;
  if (direction === 1) return ZOOM_STEPS.find((z) => z > current + eps) ?? last;
  return ZOOM_STEPS.findLast((z) => z < current - eps) ?? first ?? 1;
}

/** How much of the saved window must still be on a screen to reuse its position. */
const MIN_VISIBLE_WIDTH = 100;
const MIN_VISIBLE_HEIGHT = 40;

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { width: Math.max(0, width), height: Math.max(0, height) };
}

/**
 * Where to open the window: the saved bounds on the work area they overlap most, or null
 * (center on the primary display) when they are mostly off every screen, e.g. a monitor that
 * was unplugged. The size is kept between `min` and that work area, and the top edge stays
 * below the work area's top so the title bar (drawn by us, the only drag handle) is reachable.
 */
export function placeWindow(
  saved: Rect,
  workAreas: readonly Rect[],
  min: { width: number; height: number },
): Rect | null {
  let best: Rect | null = null;
  let bestArea = 0;
  for (const area of workAreas) {
    const { width, height } = overlap(saved, area);
    if (width < MIN_VISIBLE_WIDTH || height < MIN_VISIBLE_HEIGHT) continue;
    if (width * height > bestArea) {
      best = area;
      bestArea = width * height;
    }
  }
  if (!best) return null;
  const width = Math.max(min.width, Math.min(saved.width, best.width));
  const height = Math.max(min.height, Math.min(saved.height, best.height));
  const y = Math.max(best.y, Math.min(saved.y, best.y + best.height - MIN_VISIBLE_HEIGHT));
  return { x: saved.x, y, width, height };
}
