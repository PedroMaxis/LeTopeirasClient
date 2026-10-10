import { embedSchema, type Embed } from '@letopeiras/shared';
import type { Db } from '../db';

/** A cached preview: `embed` null means the last fetch failed or found nothing. */
export interface CachedPreview {
  embed: Embed | null;
  fetchedAt: number;
}

export function findCachedPreview(db: Db, url: string): CachedPreview | undefined {
  const row = db
    .prepare<[string], { data: string | null; fetched_at: number }>(
      'SELECT data, fetched_at FROM link_previews WHERE url = ?',
    )
    .get(url);
  if (!row) return undefined;
  let embed: Embed | null;
  try {
    embed = row.data ? embedSchema.parse(JSON.parse(row.data)) : null;
  } catch {
    // Written by an older version in another shape: treat as missing.
    embed = null;
  }
  return { embed, fetchedAt: row.fetched_at };
}

export function savePreview(db: Db, url: string, embed: Embed | null): void {
  db.prepare(
    `INSERT INTO link_previews (url, data, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT (url) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
  ).run(url, embed ? JSON.stringify(embed) : null, Date.now());
}
