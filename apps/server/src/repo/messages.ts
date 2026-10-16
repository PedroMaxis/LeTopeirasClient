import {
  embedSchema,
  LIMITS,
  type Attachment,
  type Embed,
  type Message,
  type Reaction,
} from '@letopeiras/shared';
import { z } from 'zod';
import { expectRow, type Db } from '../db';
import { attachmentsOf } from './attachments';

interface MessageRow {
  id: number;
  channel_id: number;
  author_id: number;
  content: string;
  created_at: number;
  edited_at: number | null;
  mention_ids: string | null;
  mentions_everyone: 0 | 1;
  reply_to_id: number | null;
  reply_author_id: number | null;
  reply_content: string | null;
  embeds: string | null;
}

const embedsSchema = z.array(embedSchema);

/** Stored embeds; anything unreadable just shows no previews. */
function parseEmbeds(json: string | null): Embed[] {
  if (!json) return [];
  try {
    return embedsSchema.parse(JSON.parse(json));
  } catch {
    return [];
  }
}

/** Replaces a message's link previews. False if the message is gone. */
export function setMessageEmbeds(db: Db, id: number, embeds: Embed[]): boolean {
  return (
    db
      .prepare('UPDATE messages SET embeds = ? WHERE id = ?')
      .run(embeds.length ? JSON.stringify(embeds) : null, id).changes === 1
  );
}

const toMessage = (
  row: MessageRow,
  reactions: Reaction[] = [],
  attachments: Attachment[] = [],
): Message => ({
  id: row.id,
  channelId: row.channel_id,
  authorId: row.author_id,
  content: row.content,
  createdAt: row.created_at,
  editedAt: row.edited_at,
  mentionIds: row.mention_ids ? row.mention_ids.split(',').map(Number) : [],
  mentionsEveryone: row.mentions_everyone === 1,
  replyToId: row.reply_to_id,
  replyTo:
    row.reply_author_id !== null && row.reply_content !== null
      ? { authorId: row.reply_author_id, content: row.reply_content }
      : null,
  reactions,
  embeds: parseEmbeds(row.embeds),
  attachments,
});

// The replied-to message comes along as a snippet (null once it's deleted).
const MESSAGE_COLUMNS = `
  m.*,
  (SELECT group_concat(user_id) FROM message_mentions mm WHERE mm.message_id = m.id) AS mention_ids,
  r.author_id AS reply_author_id,
  substr(r.content, 1, ${LIMITS.replySnippetMax}) AS reply_content`;

const SELECT_MESSAGE = `
  SELECT ${MESSAGE_COLUMNS}
  FROM messages m
  LEFT JOIN messages r ON r.id = m.reply_to_id`;

/**
 * Messages matching an FTS5 query in the given channels, newest first, older than `before`.
 * `match` must already be a safe FTS5 expression (see services/search.ts).
 */
export function searchMessages(
  db: Db,
  options: { match: string; channelIds: number[]; before?: number | undefined; limit: number },
): { messages: Message[]; hasMore: boolean } {
  if (options.channelIds.length === 0) return { messages: [], hasMore: false };
  const rows = db
    .prepare<(string | number)[], MessageRow>(
      `SELECT ${MESSAGE_COLUMNS}
       FROM messages_fts f
       JOIN messages m ON m.id = f.rowid
       LEFT JOIN messages r ON r.id = m.reply_to_id
       WHERE messages_fts MATCH ?
         AND m.channel_id IN (${options.channelIds.map(() => '?').join(',')})
         AND m.id < ?
       ORDER BY m.id DESC
       LIMIT ?`,
    )
    .all(
      options.match,
      ...options.channelIds,
      options.before ?? Number.MAX_SAFE_INTEGER,
      options.limit + 1,
    );
  const hasMore = rows.length > options.limit;
  const page = rows.slice(0, options.limit);
  const ids = page.map((r) => r.id);
  const reactions = reactionsOf(db, ids);
  const attachments = attachmentsOf(db, ids);
  return {
    messages: page.map((r) => toMessage(r, reactions.get(r.id), attachments.get(r.id))),
    hasMore,
  };
}

/** Reactions of these messages: emojis by first use, users in the order they reacted. */
function reactionsOf(db: Db, messageIds: number[]): Map<number, Reaction[]> {
  const byMessage = new Map<number, Reaction[]>();
  if (messageIds.length === 0) return byMessage;
  const rows = db
    .prepare<number[], { message_id: number; emoji: string; user_id: number }>(
      `SELECT message_id, emoji, user_id FROM message_reactions
       WHERE message_id IN (${messageIds.map(() => '?').join(',')})
       ORDER BY created_at, rowid`,
    )
    .all(...messageIds);
  for (const row of rows) {
    const list = byMessage.get(row.message_id) ?? [];
    const reaction = list.find((r) => r.emoji === row.emoji);
    if (reaction) reaction.userIds.push(row.user_id);
    else list.push({ emoji: row.emoji, userIds: [row.user_id] });
    byMessage.set(row.message_id, list);
  }
  return byMessage;
}

export function listReactions(db: Db, messageId: number): Reaction[] {
  return reactionsOf(db, [messageId]).get(messageId) ?? [];
}

/** Adds a reaction; false if this user already reacted with this emoji. */
export function addReaction(db: Db, messageId: number, userId: number, emoji: string): boolean {
  return (
    db
      .prepare(
        `INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(messageId, userId, emoji, Date.now()).changes === 1
  );
}

export function removeReaction(db: Db, messageId: number, userId: number, emoji: string): boolean {
  return (
    db
      .prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
      .run(messageId, userId, emoji).changes === 1
  );
}

/** Whether `emoji` is already on the message (anyone's). */
export function hasReactionEmoji(db: Db, messageId: number, emoji: string): boolean {
  return (
    db
      .prepare('SELECT 1 FROM message_reactions WHERE message_id = ? AND emoji = ? LIMIT 1')
      .get(messageId, emoji) !== undefined
  );
}

export function countReactionEmojis(db: Db, messageId: number): number {
  return expectRow(
    db
      .prepare<[number], { n: number }>(
        'SELECT COUNT(DISTINCT emoji) AS n FROM message_reactions WHERE message_id = ?',
      )
      .get(messageId),
  ).n;
}

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
    replyToId?: number | undefined;
  },
): Message {
  return db.transaction(() => {
    const { id } = expectRow(
      db
        .prepare<[number, number, string, number, number | null, number], { id: number }>(
          `INSERT INTO messages (channel_id, author_id, content, mentions_everyone, reply_to_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .get(
          input.channelId,
          input.authorId,
          input.content,
          input.mentionsEveryone ? 1 : 0,
          input.replyToId ?? null,
          Date.now(),
        ),
    );
    if (input.mentionIds?.length) setMentions(db, id, input.mentionIds);
    return expectRow(findMessage(db, id));
  })();
}

export function findMessage(db: Db, id: number): Message | undefined {
  const row = db.prepare<[number], MessageRow>(`${SELECT_MESSAGE} WHERE m.id = ?`).get(id);
  return row && toMessage(row, listReactions(db, id), attachmentsOf(db, [id]).get(id));
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
  const page = rows.slice(0, options.limit).reverse();
  const ids = page.map((r) => r.id);
  const reactions = reactionsOf(db, ids);
  const attachments = attachmentsOf(db, ids);
  return {
    messages: page.map((r) => toMessage(r, reactions.get(r.id), attachments.get(r.id))),
    hasMore,
  };
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
