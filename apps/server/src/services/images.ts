import sharp, { type Metadata } from 'sharp';
import { AppError } from '../lib/errors';

const ACCEPTED = new Set(['png', 'jpeg', 'webp', 'gif']);
/** Above this many pixels per frame the upload is refused (decompression bombs). */
const MAX_INPUT_PIXELS = 50_000_000;
const CHAT_MAX_SIDE = 1920;
const AVATAR_SIDE = 256;

const invalid = () => new AppError(400, 'invalid_image', 'Esse arquivo não é uma imagem válida');

/** Reads the header, refusing anything that isn't an accepted image or is too big to decode. */
async function inspect(input: Buffer): Promise<Metadata> {
  try {
    const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    const frameHeight = meta.pageHeight ?? meta.height;
    if (
      !meta.format ||
      !ACCEPTED.has(meta.format) ||
      !meta.width ||
      !frameHeight ||
      meta.width * frameHeight > MAX_INPUT_PIXELS
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
  const meta = await inspect(input);
  const animated = (meta.pages ?? 1) > 1;
  try {
    const { data, info } = await sharp(input, { animated, limitInputPixels: MAX_INPUT_PIXELS })
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
  await inspect(input);
  try {
    return await sharp(input, { pages: 1, limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(AVATAR_SIDE, AVATAR_SIDE, { fit: 'cover' })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    throw invalid();
  }
}
