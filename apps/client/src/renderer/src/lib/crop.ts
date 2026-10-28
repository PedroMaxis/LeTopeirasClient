// Math for the avatar cropper. The picture sits in a square view of `box` px; `offset` is how far
// its center is from the view's center, in view px, and `zoom` multiplies the "cover" scale.

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export interface Size {
  width: number;
  height: number;
}

export interface Offset {
  x: number;
  y: number;
}

export interface CropState {
  zoom: number;
  offset: Offset;
}

export interface SourceRect {
  x: number;
  y: number;
  size: number;
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Pixels on screen per image pixel at 1× zoom: the smaller side exactly covers the square. */
export function coverScale(image: Size, box: number): number {
  return box / Math.min(image.width, image.height);
}

export function scaleFor(image: Size, box: number, zoom: number): number {
  return coverScale(image, box) * clampZoom(zoom);
}

/** Keeps the picture covering the whole square: it can't be dragged past its edges. */
export function clampOffset(offset: Offset, image: Size, box: number, zoom: number): Offset {
  const scale = scaleFor(image, box, zoom);
  const maxX = Math.max(0, (image.width * scale - box) / 2);
  const maxY = Math.max(0, (image.height * scale - box) / 2);
  // `+ 0` turns a -0 (from -maxX with maxX = 0) into 0.
  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)) + 0,
    y: Math.min(maxY, Math.max(-maxY, offset.y)) + 0,
  };
}

/** Zooms around the center of the square, so what is in the middle stays in the middle. */
export function zoomTo(state: CropState, zoom: number, image: Size, box: number): CropState {
  const next = clampZoom(zoom);
  const ratio = next / state.zoom;
  return {
    zoom: next,
    offset: clampOffset({ x: state.offset.x * ratio, y: state.offset.y * ratio }, image, box, next),
  };
}

export function panBy(
  state: CropState,
  dx: number,
  dy: number,
  image: Size,
  box: number,
): CropState {
  return {
    zoom: state.zoom,
    offset: clampOffset({ x: state.offset.x + dx, y: state.offset.y + dy }, image, box, state.zoom),
  };
}

/** The square of the original image (in its pixels) that the view is showing. */
export function sourceRect(state: CropState, image: Size, box: number): SourceRect {
  const scale = scaleFor(image, box, state.zoom);
  const offset = clampOffset(state.offset, image, box, state.zoom);
  const size = box / scale;
  const x = ((image.width * scale) / 2 - box / 2 - offset.x) / scale;
  const y = ((image.height * scale) / 2 - box / 2 - offset.y) / scale;
  return {
    x: Math.min(image.width - size, Math.max(0, x)),
    y: Math.min(image.height - size, Math.max(0, y)),
    size,
  };
}
