import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db';

describe('migration 8 (attachments)', () => {
  it('stores and reads an attachment, with its indexes', () => {
    const db = openDatabase(':memory:');
    const user = db
      .prepare(
        `INSERT INTO users (username, display_name, password_hash, is_admin, created_at)
         VALUES ('u', 'U', 'x', 0, 1)`,
      )
      .run();
    db.prepare(
      `INSERT INTO attachments (uploader_id, hash, width, height, size, created_at)
       VALUES (?, 'abcdef', 10, 20, 300, 5)`,
    ).run(user.lastInsertRowid);

    const row = db.prepare('SELECT * FROM attachments').get() as Record<string, unknown>;
    expect(row).toMatchObject({
      uploader_id: Number(user.lastInsertRowid),
      message_id: null,
      position: 0,
      hash: 'abcdef',
      width: 10,
      height: 20,
      size: 300,
      created_at: 5,
    });

    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'attachments'`)
      .all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain('attachments_message');
    expect(names).toContain('attachments_hash');
    db.close();
  });
});
