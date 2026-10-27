import type { Category, Channel, Message } from '@letopeiras/shared';

/** Text channels first, then voice, each by position (like Discord). */
export const byTypeThenPosition = (a: Channel, b: Channel) =>
  (a.type === b.type ? 0 : a.type === 'text' ? -1 : 1) || a.position - b.position || a.id - b.id;

/** Every channel in the order the sidebar shows them: uncategorized first, then by category. */
export function sidebarOrder(
  channels: readonly Channel[],
  categories: readonly Category[],
): Channel[] {
  const inCategory = (categoryId: number | null) =>
    channels.filter((c) => c.categoryId === categoryId).sort(byTypeThenPosition);
  return [
    ...inCategory(null),
    ...[...categories]
      .sort((a, b) => a.position - b.position || a.id - b.id)
      .flatMap((c) => inCategory(c.id)),
  ];
}

/** A text channel with messages newer than our read marker. */
export const isUnread = (channel: Channel, readStates: Record<number, number>) =>
  channel.type === 'text' &&
  channel.lastMessageId !== null &&
  channel.lastMessageId > (readStates[channel.id] ?? 0);

export interface UnreadSummary {
  /** Loaded messages from others after the read marker. */
  count: number;
  /** The first of them, once history is loaded back that far. */
  first: Message | undefined;
  /** Older pages still hide the start of the unread stretch ("Mais de N"). */
  more: boolean;
}

/** What the "novas mensagens" bar says: the unread stretch after `readMarker`, as far as loaded. */
export function summarizeUnread(
  messages: readonly Message[],
  hasMore: boolean,
  readMarker: number,
  meId: number | undefined,
): UnreadSummary {
  const unread = messages.filter((m) => m.id > readMarker && m.authorId !== meId);
  const reachedMarker = !hasMore || (messages[0] !== undefined && messages[0].id <= readMarker);
  return {
    count: unread.length,
    first: reachedMarker ? unread[0] : undefined,
    more: !reachedMarker,
  };
}

/** Lowercase without accents, for matching what people type ("jogos" finds "Jógos"). */
export const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * How well `name` matches `query` (both normalized): higher is better, 0 is no match.
 * Prefix > start of a word > anywhere > the letters in order (abbreviations).
 */
export function matchScore(name: string, query: string): number {
  if (!query) return 1;
  if (name.startsWith(query)) return 4;
  if (new RegExp(`[\\s_-]${escapeRegExp(query)}`).test(name)) return 3;
  if (name.includes(query)) return 2;
  let at = 0;
  for (const char of name) if (char === query[at]) at++;
  return at === query.length ? 1 : 0;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
