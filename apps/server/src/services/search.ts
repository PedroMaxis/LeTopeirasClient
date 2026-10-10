import type { SearchResponse, User } from '@letopeiras/shared';
import type { Db } from '../db';
import { listChannels } from '../repo/channels';
import { searchMessages } from '../repo/messages';
import { canAccess, requireAccess } from './access';

/**
 * Turns what someone typed into an FTS5 query: every word must appear, each as a prefix
 * ("bol" finds "bolo"). Only letters and digits survive, quoted, so nothing typed can be
 * read as FTS5 syntax (NOT, NEAR, column filters…). Null when there are no words.
 */
export function toMatchExpression(query: string): string | null {
  const words = query.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 12) ?? [];
  return words.length ? words.map((w) => `"${w}"*`).join(' ') : null;
}

/** Messages in text channels `user` can open (or just `channelId`), newest first. */
export function search(
  db: Db,
  user: User,
  query: { q: string; channelId?: number | undefined; before?: number | undefined; limit: number },
): SearchResponse {
  const match = toMatchExpression(query.q);
  if (!match) return { messages: [], hasMore: false };
  const channelIds =
    query.channelId !== undefined
      ? [requireAccess(db, user, query.channelId).id]
      : listChannels(db)
          .filter((c) => c.type === 'text' && canAccess(user, c))
          .map((c) => c.id);
  return searchMessages(db, { match, channelIds, before: query.before, limit: query.limit });
}
