// Pure emoji logic: catalog, search, frequency and the ":shortcode" being typed.
// The data itself (emojibase) is loaded on demand by `emoji-data.ts`.

export const EMOJI_GROUPS = [
  'Carinhas',
  'Pessoas',
  'Natureza',
  'Comida',
  'Viagens',
  'Atividades',
  'Objetos',
  'Símbolos',
  'Bandeiras',
] as const;

export interface EmojiEntry {
  emoji: string;
  name: string;
  /** Index into EMOJI_GROUPS. */
  group: number;
  order: number;
  /** Lowercase, no accents. */
  nameKey: string;
  tagKeys: string[];
  shortcodes: string[];
}

/** The fields we use from emojibase's `compact.json`. */
export interface RawEmoji {
  hexcode: string;
  label: string;
  unicode: string;
  group?: number;
  order?: number;
  tags?: string[];
}

export type RawShortcodes = Record<string, string | string[]>;

/** Emojibase's own group numbers (0–9, 2 = skin tone components) → our EMOJI_GROUPS index. */
const GROUP_INDEX: Record<number, number> = {
  0: 0,
  1: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 6,
  8: 7,
  9: 8,
};

export const DEFAULT_REACTIONS = ['👍', '😂', '❤️', '😮'];

/** Lowercase without accents, so "coracao" finds "coração". */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export function buildCatalog(raw: RawEmoji[], shortcodes: RawShortcodes): EmojiEntry[] {
  const entries: EmojiEntry[] = [];
  for (const item of raw) {
    const group = item.group === undefined ? undefined : GROUP_INDEX[item.group];
    if (group === undefined) continue;
    const codes = shortcodes[item.hexcode];
    entries.push({
      emoji: item.unicode,
      name: item.label,
      group,
      order: item.order ?? 0,
      nameKey: normalize(item.label),
      tagKeys: (item.tags ?? []).map(normalize),
      shortcodes: codes === undefined ? [] : Array.isArray(codes) ? codes : [codes],
    });
  }
  return entries.sort((a, b) => a.order - b.order);
}

/** Lower is better; -1 = no match. */
function score(entry: EmojiEntry, q: string): number {
  if (entry.shortcodes.includes(q)) return 0;
  if (entry.shortcodes.some((code) => code.startsWith(q))) return 1;
  const words = entry.nameKey.split(/[\s:_-]+/);
  if (entry.nameKey.startsWith(q)) return 2;
  if (words.some((word) => word.startsWith(q))) return 3;
  if (
    entry.tagKeys.some((tag) => tag.startsWith(q) || tag.split(/\s+/).some((w) => w.startsWith(q)))
  )
    return 4;
  if (entry.nameKey.includes(q) || entry.shortcodes.some((code) => code.includes(q))) return 5;
  return -1;
}

/** Name, keyword or shortcode, ignoring accents and case; best matches first. */
export function searchEmojis(catalog: EmojiEntry[], query: string, limit = Infinity): EmojiEntry[] {
  const q = normalize(query.trim().replace(/^:|:$/g, ''));
  if (!q) return [];
  const found: { entry: EmojiEntry; score: number }[] = [];
  for (const entry of catalog) {
    const s = score(entry, q);
    if (s >= 0) found.push({ entry, score: s });
  }
  found.sort((a, b) => a.score - b.score || a.entry.order - b.entry.order);
  return found.slice(0, limit).map((f) => f.entry);
}

/* ------------------------------------------------------------- frequency */

export type EmojiUsage = Record<string, { count: number; last: number }>;

const DAY = 24 * 60 * 60 * 1000;
/** A use is worth half after this many days. */
const HALF_LIFE_DAYS = 14;
const MAX_TRACKED = 200;

export function recordUse(usage: EmojiUsage, emoji: string, now: number): EmojiUsage {
  const current = usage[emoji];
  const next: EmojiUsage = { ...usage, [emoji]: { count: (current?.count ?? 0) + 1, last: now } };
  const entries = Object.entries(next);
  if (entries.length <= MAX_TRACKED) return next;
  // Forget the ones with the least weight so the stored object stays small.
  entries.sort(([, x], [, y]) => weight(y, now) - weight(x, now));
  return Object.fromEntries(entries.slice(0, MAX_TRACKED));
}

function weight(use: EmojiUsage[string] | undefined, now: number): number {
  if (!use) return 0;
  const days = Math.max(0, now - use.last) / DAY;
  return use.count * 0.5 ** (days / HALF_LIFE_DAYS);
}

/** Most used first (recent uses count more); at most `limit`. */
export function topEmojis(usage: EmojiUsage, now: number, limit: number): string[] {
  return Object.keys(usage)
    .sort((a, b) => weight(usage[b], now) - weight(usage[a], now) || a.localeCompare(b))
    .slice(0, limit);
}

/** The most used emojis, filled up with the defaults when there are fewer than `size`. */
export function quickReactions(usage: EmojiUsage, now: number, size: number): string[] {
  const picked = topEmojis(usage, now, size);
  for (const emoji of DEFAULT_REACTIONS) {
    if (picked.length >= size) break;
    if (!picked.includes(emoji)) picked.push(emoji);
  }
  return picked;
}

/* ------------------------------------------------------------- ":" typing */

/** A ":que" being typed right before the cursor (at the start or after whitespace, 2+ letters). */
export function shortcodeQueryAt(
  text: string,
  cursor: number,
): { start: number; query: string; closed: boolean } | null {
  const match = /(?:^|\s):([\p{L}\p{N}_+-]{2,32})(:?)$/u.exec(text.slice(0, cursor));
  if (match?.[1] === undefined) return null;
  const closed = match[2] === ':';
  return {
    start: cursor - match[1].length - (closed ? 2 : 1),
    query: match[1],
    closed,
  };
}

/** A closed ":joy:" that names exactly one emoji; null if it doesn't. */
export function exactShortcode(catalog: EmojiEntry[], query: string): EmojiEntry | null {
  const q = normalize(query);
  return catalog.find((entry) => entry.shortcodes.includes(q)) ?? null;
}
