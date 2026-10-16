import sharp, { type Metadata } from 'sharp';
import { AppError } from '../lib/errors';

const ACCEPTED = new Set(['png', 'jpeg', 'webp', 'gif']);
/** Above this many pixels per frame the upload is refused (decompression bombs). */
const MAX_FRAME_PIXELS = 50_000_000;
/**
 * All frames of an animation together. sharp's `limitInputPixels` counts every frame, so a
 * 10 s, 500×500 GIF is already ~60 MP; this bounds the CPU time (decoding streams, memory
 * stays low).
 */
const MAX_TOTAL_PIXELS = 100_000_000;
const CHAT_MAX_SIDE = 1920;
const AVATAR_SIDE = 256;

const invalid = () => new AppError(400, 'invalid_image', 'Esse arquivo não é uma imagem válida');

/**
 * Reads the header, refusing anything that isn't an accepted image or is too big to decode.
 * `allFrames`: whether every frame will be decoded (chat) or only the first (avatar).
 */
async function inspect(input: Buffer, allFrames: boolean): Promise<Metadata> {
  try {
    // The header only; the real limits are checked below.
    const meta = await sharp(input, { limitInputPixels: false }).metadata();
    const frameHeight = meta.pageHeight ?? meta.height;
    const frames = allFrames ? (meta.pages ?? 1) : 1;
    if (
      !meta.format ||
      !ACCEPTED.has(meta.format) ||
      !meta.width ||
      !frameHeight ||
      meta.width * frameHeight > MAX_FRAME_PIXELS ||
      meta.width * frameHeight * frames > MAX_TOTAL_PIXELS
    ) {
      throw invalid();
    }
    return meta;
  } catch (err) {
    throw err instanceof AppError ? err : invalid();
  }
}

/** WebP for chat: longest side ≤ 1920 px, quality 75, animation kept. No EXIF/GPS. */
export async function toChatImage(
  input: Buffer,
): Promise<{ data: Buffer; width: number; height: number }> {
  const meta = await inspect(input, true);
  const animated = (meta.pages ?? 1) > 1;
  try {
    const { data, info } = await sharp(input, { animated, limitInputPixels: MAX_TOTAL_PIXELS })
      .rotate()
      .resize({
        width: CHAT_MAX_SIDE,
        height: CHAT_MAX_SIDE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 75, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    // For animations, info.height is all frames stacked.
    const height = animated ? (info.pageHeight ?? info.height) : info.height;
    return { data, width: info.width, height };
  } catch {
    throw invalid();
  }
}

/** Square profile picture: center crop, 256×256, first frame only. */
export async function toAvatar(input: Buffer): Promise<Buffer> {
  await inspect(input, false);
  try {
    return await sharp(input, { pages: 1, limitInputPixels: MAX_FRAME_PIXELS })
      .rotate()
      .resize(AVATAR_SIDE, AVATAR_SIDE, { fit: 'cover' })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    throw invalid();
  }
}
