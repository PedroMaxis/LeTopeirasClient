import type { ReadState } from '@letopeiras/shared';
import type { Db } from '../db';

export function listReadStates(db: Db, userId: number): ReadState[] {
  return db
    .prepare<[number], { channel_id: number; last_read_message_id: number }>(
      'SELECT channel_id, last_read_message_id FROM read_state WHERE user_id = ?',
    )
    .all(userId)
    .map((row) => ({ channelId: row.channel_id, lastReadMessageId: row.last_read_message_id }));
}

/** Moves the read marker forward (never backward). Returns true if it changed. */
export function markRead(db: Db, userId: number, channelId: number, messageId: number): boolean {
  const result = db
    .prepare(
      `INSERT INTO read_state (user_id, channel_id, last_read_message_id) VALUES (?, ?, ?)
       ON CONFLICT (user_id, channel_id) DO UPDATE
         SET last_read_message_id = excluded.last_read_message_id
         WHERE excluded.last_read_message_id > read_state.last_read_message_id`,
    )
    .run(userId, channelId, messageId);
  return result.changes === 1;
}
