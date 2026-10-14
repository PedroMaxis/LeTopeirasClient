import type { Attachment } from '@letopeiras/shared';
import { expectRow, type Db } from '../db';

interface AttachmentRow {
  id: number;
  message_id: number | null;
  hash: string;
  width: number;
  height: number;
}

const toAttachment = (row: AttachmentRow): Attachment => ({
  id: row.id,
  url: `/files/${row.hash}.webp`,
  width: row.width,
  height: row.height,
});

export function createAttachment(
  db: Db,
  input: { uploaderId: number; hash: string; width: number; height: number; size: number },
): Attachment {
  const row = db
    .prepare<[number, string, number, number, number, number], AttachmentRow>(
      `INSERT INTO attachments (uploader_id, hash, width, height, size, created_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(input.uploaderId, input.hash, input.width, input.height, input.size, Date.now());
  return toAttachment(expectRow(row));
}

/**
 * Attaches the uploader's unsent uploads to a message, in the given order. Returns false if any
 * id isn't an unsent upload of theirs; the caller's transaction decides what to do with the rest.
 */
export function claimAttachments(
  db: Db,
  messageId: number,
  uploaderId: number,
  ids: number[],
): boolean {
  const claim = db.prepare(
    `UPDATE attachments SET message_id = ?, position = ?
     WHERE id = ? AND uploader_id = ? AND message_id IS NULL`,
  );
  return ids.every((id, position) => claim.run(messageId, position, id, uploaderId).changes === 1);
}

/** Attachments of these messages, in order. */
export function attachmentsOf(db: Db, messageIds: number[]): Map<number, Attachment[]> {
  const byMessage = new Map<number, Attachment[]>();
  if (messageIds.length === 0) return byMessage;
  const rows = db
    .prepare<number[], AttachmentRow>(
      `SELECT * FROM attachments WHERE message_id IN (${messageIds.map(() => '?').join(',')})
       ORDER BY message_id, position`,
    )
    .all(...messageIds);
  for (const row of rows) {
    const list = byMessage.get(row.message_id ?? 0) ?? [];
    list.push(toAttachment(row));
    byMessage.set(row.message_id ?? 0, list);
  }
  return byMessage;
}

export function attachmentHashes(db: Db, messageId: number): string[] {
  return db
    .prepare<[number], { hash: string }>('SELECT hash FROM attachments WHERE message_id = ?')
    .all(messageId)
    .map((r) => r.hash);
}

export function deleteStaleAttachments(db: Db, olderThan: number): void {
  db.prepare('DELETE FROM attachments WHERE message_id IS NULL AND created_at < ?').run(olderThan);
}

/** Whether any attachment row or avatar still uses this file. */
export function isHashReferenced(db: Db, hash: string, url: string): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM attachments WHERE hash = ?
         UNION ALL SELECT 1 FROM users WHERE avatar_url = ? LIMIT 1`,
      )
      .get(hash, url) !== undefined
  );
}
