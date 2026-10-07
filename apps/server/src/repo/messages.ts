import type { Message } from '@letopeiras/shared';
import { expectRow, type Db } from '../db';

interface MessageRow {
  id: number;
  channel_id: number;
  author_id: number;
  content: string;
  created_at: number;
  edited_at: number | null;
  mention_ids: string | null;
  mentions_everyone: 0 | 1;
}

const toMessage = (row: MessageRow): Message => ({
  id: row.id,
  channelId: row.channel_id,
  authorId: row.author_id,
  content: row.content,
  createdAt: row.created_at,
  editedAt: row.edited_at,
  mentionIds: row.mention_ids ? row.mention_ids.split(',').map(Number) : [],
  mentionsEveryone: row.mentions_everyone === 1,
});

const SELECT_MESSAGE = `
  SELECT m.*,
         (SELECT group_concat(user_id) FROM message_mentions mm WHERE mm.message_id = m.id) AS mention_ids
  FROM messages m`;

/** Replaces who a message mentions. */
function setMentions(db: Db, messageId: number, userIds: number[]): void {
  db.prepare('DELETE FROM message_mentions WHERE message_id = ?').run(messageId);
  const insert = db.prepare('INSERT INTO message_mentions (message_id, user_id) VALUES (?, ?)');
  for (const userId of new Set(userIds)) insert.run(messageId, userId);
}

export function createMessage(
  db: Db,
  input: {
    channelId: number;
    authorId: number;
    content: string;
    mentionIds?: number[];
    mentionsEveryone?: boolean;
  },
): Message {
  return db.transaction(() => {
    const { id } = expectRow(
      db
        .prepare<[number, number, string, number, number], { id: number }>(
          `INSERT INTO messages (channel_id, author_id, content, mentions_everyone, created_at)
           VALUES (?, ?, ?, ?, ?) RETURNING id`,
        )
        .get(
          input.channelId,
          input.authorId,
          input.content,
          input.mentionsEveryone ? 1 : 0,
          Date.now(),
        ),
    );
    if (input.mentionIds?.length) setMentions(db, id, input.mentionIds);
    return expectRow(findMessage(db, id));
  })();
}

export function findMessage(db: Db, id: number): Message | undefined {
  const row = db.prepare<[number], MessageRow>(`${SELECT_MESSAGE} WHERE m.id = ?`).get(id);
  return row && toMessage(row);
}

export function updateMessageContent(
  db: Db,
  id: number,
  content: string,
  mentions: { mentionIds: number[]; mentionsEveryone: boolean } = {
    mentionIds: [],
    mentionsEveryone: false,
  },
): Message | undefined {
  const { mentionIds } = mentions;
  return db.transaction(() => {
    const changed = db
      .prepare('UPDATE messages SET content = ?, mentions_everyone = ?, edited_at = ? WHERE id = ?')
      .run(content, mentions.mentionsEveryone ? 1 : 0, Date.now(), id).changes;
    if (!changed) return undefined;
    setMentions(db, id, mentionIds);
    return findMessage(db, id);
  })();
}

export function deleteMessage(db: Db, id: number): boolean {
  return db.prepare('DELETE FROM messages WHERE id = ?').run(id).changes === 1;
}

/** Up to `limit` messages older than `before` (or the newest), sorted oldest → newest. */
export function listMessages(
  db: Db,
  channelId: number,
  options: { before?: number | undefined; limit: number },
): { messages: Message[]; hasMore: boolean } {
  const rows = db
    .prepare<[number, number, number], MessageRow>(
      `${SELECT_MESSAGE} WHERE m.channel_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`,
    )
    .all(channelId, options.before ?? Number.MAX_SAFE_INTEGER, options.limit + 1);
  const hasMore = rows.length > options.limit;
  return { messages: rows.slice(0, options.limit).reverse().map(toMessage), hasMore };
}

/** Unread messages mentioning `userId` (by name or @todos, written by someone else), per channel. */
export function unreadMentionCounts(
  db: Db,
  userId: number,
): { channelId: number; count: number }[] {
  return db
    .prepare<[number, number, number], { channelId: number; count: number }>(
      `SELECT m.channel_id AS channelId, COUNT(*) AS count
       FROM messages m
       LEFT JOIN read_state rs ON rs.user_id = ? AND rs.channel_id = m.channel_id
       WHERE m.author_id != ?
         AND m.id > COALESCE(rs.last_read_message_id, 0)
         AND (m.mentions_everyone = 1 OR EXISTS (
           SELECT 1 FROM message_mentions mm WHERE mm.message_id = m.id AND mm.user_id = ?
         ))
       GROUP BY m.channel_id`,
    )
    .all(userId, userId, userId);
}
