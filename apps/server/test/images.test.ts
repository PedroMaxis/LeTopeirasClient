import { existsSync, mkdtempSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { openDatabase } from '../src/db';
import { createAttachment } from '../src/repo/attachments';
import { createUser } from '../src/repo/users';
import { FileStore } from '../src/services/files';
import { toAvatar, toChatImage } from '../src/services/images';

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#c0392b' } })
    .png()
    .toBuffer();

describe('toChatImage', () => {
  it('converts to WebP and caps the longest side at 1920 px', async () => {
    const out = await toChatImage(await png(4000, 2000));
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe('webp');
    expect([out.width, out.height]).toEqual([1920, 960]);
  });

  it('never enlarges small images', async () => {
    const out = await toChatImage(await png(300, 200));
    expect([out.width, out.height]).toEqual([300, 200]);
  });

  it('keeps GIFs animated', async () => {
    const frame = (color: string) =>
      sharp({ create: { width: 40, height: 40, channels: 3, background: color } })
        .png()
        .toBuffer();
    const gif = await sharp([await frame('#f00'), await frame('#00f')], {
      join: { animated: true },
    })
      .gif({ loop: 0 })
      .toBuffer();
    const out = await toChatImage(gif);
    const meta = await sharp(out.data, { animated: true }).metadata();
    expect([meta.format, meta.pages, out.width, out.height]).toEqual(['webp', 2, 40, 40]);
  });

  /** An animated GIF of `count` distinct frames (distinct, so the encoder keeps them all). */
  const animation = async (side: number, count: number) => {
    const frames = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        sharp({
          create: {
            width: side,
            height: side,
            channels: 3,
            background: { r: i % 256, g: (i * 3) % 256, b: (i * 7) % 256 },
          },
        })
          .png()
          .toBuffer(),
      ),
    );
    const gif = await sharp(frames, { join: { animated: true } })
      .gif()
      .toBuffer();
    const { pages = 1 } = await sharp(gif, { limitInputPixels: false }).metadata();
    return { gif, totalPixels: side * side * pages };
  };

  it('keeps long GIFs whose frames add up to more than the per-frame limit', async () => {
    const { gif, totalPixels } = await animation(400, 340);
    expect(totalPixels).toBeGreaterThan(50_000_000);
    const out = await toChatImage(gif);
    expect([out.width, out.height]).toEqual([400, 400]);
  }, 30_000);

  it('rejects animations with too many pixels in all', async () => {
    const { gif, totalPixels } = await animation(1000, 110);
    expect(totalPixels).toBeGreaterThan(100_000_000);
    await expect(toChatImage(gif)).rejects.toMatchObject({ code: 'invalid_image' });
  }, 30_000);

  it('rejects things that are not images', async () => {
    await expect(toChatImage(Buffer.from('not an image'))).rejects.toMatchObject({
      code: 'invalid_image',
    });
  });

  it('rejects decompression bombs', async () => {
    // A tiny file that declares 20000×20000 pixels.
    const bomb = await sharp({
      create: { width: 20000, height: 20000, channels: 3, background: '#000' },
      limitInputPixels: false,
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await expect(toChatImage(bomb)).rejects.toMatchObject({ code: 'invalid_image' });
  });

  it('rejects formats outside PNG/JPEG/WebP/GIF', async () => {
    const tiff = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } })
      .tiff()
      .toBuffer();
    await expect(toChatImage(tiff)).rejects.toMatchObject({ code: 'invalid_image' });
  });
});

describe('toAvatar', () => {
  it('crops to a 256×256 square', async () => {
    const meta = await sharp(await toAvatar(await png(800, 400))).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 256, 256]);
  });
});

describe('FileStore', () => {
  const setup = () => {
    const db = openDatabase(':memory:');
    const user = createUser(db, { username: 'ana', displayName: 'Ana', passwordHash: 'x' });
    return { db, user, store: new FileStore(mkdtempSync(join(tmpdir(), 'lt-files-'))) };
  };

  it('stores identical content once', async () => {
    const { store } = setup();
    const a = await store.save(Buffer.from('same'));
    const b = await store.save(Buffer.from('same'));
    expect(a).toBe(b);
    expect(existsSync(store.pathOf(a))).toBe(true);
  });

  it('saves the same new content concurrently without clashing', async () => {
    const { store } = setup();
    const hashes = await Promise.all(Array.from({ length: 8 }, () => store.save(Buffer.from('x'))));
    expect(new Set(hashes).size).toBe(1);
    expect(existsSync(store.pathOf(hashes[0] ?? ''))).toBe(true);
  });

  it('saving existing content refreshes it, so the sweep keeps it', async () => {
    const { db, store } = setup();
    const hash = await store.save(Buffer.from('again'));
    const old = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    utimesSync(store.pathOf(hash), old, old);
    await store.save(Buffer.from('again'));
    // Not referenced yet (the attachment row comes right after), but just saved again.
    await store.sweep(db);
    expect(existsSync(store.pathOf(hash))).toBe(true);
  });

  it('collect keeps referenced files and deletes the rest', async () => {
    const { db, user, store } = setup();
    const used = await store.save(Buffer.from('used'));
    const unused = await store.save(Buffer.from('unused'));
    createAttachment(db, { uploaderId: user.id, hash: used, width: 1, height: 1, size: 4 });
    await store.collect(db, [used, unused]);
    expect(existsSync(store.pathOf(used))).toBe(true);
    expect(existsSync(store.pathOf(unused))).toBe(false);
  });

  it('sweep drops uploads never sent after an hour, with their file', async () => {
    const { db, user, store } = setup();
    const hash = await store.save(Buffer.from('draft'));
    createAttachment(db, { uploaderId: user.id, hash, width: 1, height: 1, size: 5 });
    const old = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    utimesSync(store.pathOf(hash), old, old);
    await store.sweep(db, Date.now() + 2 * 60 * 60 * 1000);
    expect(existsSync(store.pathOf(hash))).toBe(false);
  });
});
