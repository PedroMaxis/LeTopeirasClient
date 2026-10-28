import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  clampOffset,
  clampZoom,
  coverScale,
  panBy,
  sourceRect,
  zoomTo,
  type CropState,
} from './crop';

const wide = { width: 800, height: 400 };
const box = 200;
const start: CropState = { zoom: 1, offset: { x: 0, y: 0 } };

describe('crop', () => {
  it('covers the square with the smaller side at 1×', () => {
    expect(coverScale(wide, box)).toBe(0.5);
    expect(coverScale({ width: 300, height: 600 }, box)).toBeCloseTo(200 / 300);
  });

  it('limits zoom to 1×–4×', () => {
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(9)).toBe(MAX_ZOOM);
    expect(clampZoom(2.5)).toBe(2.5);
  });

  it('only lets a wide picture move sideways at 1×', () => {
    expect(clampOffset({ x: 999, y: 999 }, wide, box, 1)).toEqual({ x: 100, y: 0 });
    expect(clampOffset({ x: -999, y: -999 }, wide, box, 1)).toEqual({ x: -100, y: 0 });
  });

  it('allows more movement when zoomed in', () => {
    expect(clampOffset({ x: 999, y: 999 }, wide, box, 2)).toEqual({ x: 300, y: 100 });
  });

  it('shows the central square at the start', () => {
    expect(sourceRect(start, wide, box)).toEqual({ x: 200, y: 0, size: 400 });
  });

  it('moves the source area opposite to the drag', () => {
    const moved = panBy(start, 40, 0, wide, box);
    expect(sourceRect(moved, wide, box)).toEqual({ x: 120, y: 0, size: 400 });
  });

  it('never leaves the image, even when dragged far away', () => {
    const moved = panBy(start, -5000, 5000, wide, box);
    const rect = sourceRect(moved, wide, box);
    expect(rect.x).toBe(400);
    expect(rect.y).toBe(0);
    expect(rect.x + rect.size).toBeLessThanOrEqual(wide.width);
  });

  it('shrinks the source area when zooming, around the center', () => {
    const zoomed = zoomTo(start, 2, wide, box);
    expect(sourceRect(zoomed, wide, box)).toEqual({ x: 300, y: 100, size: 200 });
  });

  it('keeps the offset inside the new limits when zooming out', () => {
    const zoomedIn = panBy(zoomTo(start, 4, wide, box), -5000, 0, wide, box);
    const out = zoomTo(zoomedIn, 1, wide, box);
    expect(out.offset).toEqual({ x: -100, y: 0 });
    expect(sourceRect(out, wide, box).x).toBe(400);
  });
});
