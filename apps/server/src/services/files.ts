import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '../db';
import { deleteStaleAttachments, isHashReferenced } from '../repo/attachments';

const HASH = /^[0-9a-f]{64}$/;
const URL_PATTERN = /^\/files\/([0-9a-f]{64})\.webp$/;
/** Unattached uploads (and files nobody references) older than this are removed. */
export const UPLOAD_TTL_MS = 60 * 60 * 1000;

export const fileUrl = (hash: string) => `/files/${hash}.webp`;
export const hashFromUrl = (url: string | null): string | null =>
  url?.match(URL_PATTERN)?.[1] ?? null;
export const isHash = (value: string) => HASH.test(value);

/**
 * Content-addressed image files: the name is the SHA-256 of the WebP, so the same image is
 * stored once however many messages (or avatars) use it.
 */
export class FileStore {
  constructor(private readonly dir: string) {}

  pathOf(hash: string): string {
    return join(this.dir, hash.slice(0, 2), `${hash}.webp`);
  }

  async save(data: Buffer): Promise<string> {
    const hash = createHash('sha256').update(data).digest('hex');
    const path = this.pathOf(hash);
    try {
      // Already stored: touch it, so the sweep (which only removes files older than the TTL)
      // can't take it before the caller's row references it.
      const now = new Date();
      await utimes(path, now, now);
      return hash;
    } catch {
      // New file: write to a temp name and rename, so a reader never sees half a file.
    }
    await mkdir(join(this.dir, hash.slice(0, 2)), { recursive: true });
    // Unique per call: two uploads of the same image at once must not share a temp file.
    const tmp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, data);
      await rename(tmp, path);
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      // Another save of the same content got there first (Windows refuses the rename then);
      // the name is the content's hash, so its file is ours too.
      const stored = await stat(path).catch(() => null);
      if (!stored) throw err;
    }
    return hash;
  }

  /** Deletes the files of these hashes that no attachment or avatar uses anymore. */
  async collect(db: Db, hashes: Iterable<string>): Promise<void> {
    for (const hash of new Set(hashes)) {
      if (!isHash(hash) || isHashReferenced(db, hash, fileUrl(hash))) continue;
      await unlink(this.pathOf(hash)).catch(() => undefined);
    }
  }

  /**
   * Drops uploads never sent within the TTL, then any file nobody references that is older
   * than the TTL (messages removed with their channel, interrupted uploads…).
   */
  async sweep(db: Db, now = Date.now()): Promise<void> {
    deleteStaleAttachments(db, now - UPLOAD_TTL_MS);
    let shards: string[];
    try {
      shards = await readdir(this.dir);
    } catch {
      return; // Nothing uploaded yet.
    }
    for (const shard of shards) {
      for (const name of await readdir(join(this.dir, shard)).catch(() => [])) {
        const path = join(this.dir, shard, name);
        const hash = name.replace(/\.webp$/, '');
        const old = (await stat(path).catch(() => null))?.mtimeMs ?? now;
        if (now - old < UPLOAD_TTL_MS) continue;
        if (name.endsWith('.tmp') || !isHash(hash) || !isHashReferenced(db, hash, fileUrl(hash))) {
          await unlink(path).catch(() => undefined);
        }
      }
    }
  }
}
