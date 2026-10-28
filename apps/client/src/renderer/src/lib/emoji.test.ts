import { describe, expect, it } from 'vitest';
import { isReactionEmoji } from '@letopeiras/shared';
import {
  buildCatalog,
  exactShortcode,
  quickReactions,
  recordUse,
  searchEmojis,
  shortcodeQueryAt,
  topEmojis,
  type EmojiUsage,
  type RawEmoji,
  type RawShortcodes,
} from './emoji';

const raw: RawEmoji[] = [
  {
    hexcode: '1F602',
    label: 'rosto chorando de rir',
    unicode: '😂',
    group: 0,
    order: 8,
    tags: ['alegria', 'gargalhada', 'kkk'],
  },
  {
    hexcode: '2764-FE0F',
    label: 'coração vermelho',
    unicode: '❤️',
    group: 0,
    order: 100,
    tags: ['amor'],
  },
  { hexcode: '1F44D', label: 'joinha', unicode: '👍', group: 1, order: 200, tags: ['aprovado'] },
  { hexcode: '1F3FB', label: 'tom de pele claro', unicode: '🏻', group: 2, order: 300 },
  {
    hexcode: '1F1E7-1F1F7',
    label: 'bandeira: Brasil',
    unicode: '🇧🇷',
    group: 9,
    order: 400,
    tags: ['BR'],
  },
];
const catalog = buildCatalog(raw, {
  '1F602': ['joy', 'haha'],
  '2764-FE0F': 'heart',
  '1F44D': ['+1', 'thumbsup'],
});

describe('catalog', () => {
  it('drops skin tone components and keeps the Unicode order', () => {
    expect(catalog.map((e) => e.emoji)).toEqual(['😂', '❤️', '👍', '🇧🇷']);
  });

  it('maps groups and shortcodes', () => {
    expect(catalog[0]?.shortcodes).toEqual(['joy', 'haha']);
    expect(catalog[1]?.shortcodes).toEqual(['heart']);
    expect(catalog[3]?.group).toBe(8);
  });
});

describe('searchEmojis', () => {
  it('finds by shortcode, with or without colons', () => {
    expect(searchEmojis(catalog, 'joy')[0]?.emoji).toBe('😂');
    expect(searchEmojis(catalog, ':joy:')[0]?.emoji).toBe('😂');
  });

  it('finds by name ignoring accents', () => {
    expect(searchEmojis(catalog, 'coracao').map((e) => e.emoji)).toEqual(['❤️']);
  });

  it('finds by keyword', () => {
    expect(searchEmojis(catalog, 'kkk').map((e) => e.emoji)).toEqual(['😂']);
  });

  it('puts exact shortcodes before looser matches', () => {
    const emojis = searchEmojis(catalog, 'heart').map((e) => e.emoji);
    expect(emojis[0]).toBe('❤️');
  });

  it('returns nothing for an empty query and honors the limit', () => {
    expect(searchEmojis(catalog, '  ')).toEqual([]);
    expect(searchEmojis(catalog, 'r', 1)).toHaveLength(1);
  });
});

describe('usage', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = 100 * day;

  it('counts uses', () => {
    let usage: EmojiUsage = {};
    usage = recordUse(usage, '😂', now);
    usage = recordUse(usage, '😂', now);
    expect(usage['😂']).toEqual({ count: 2, last: now });
  });

  it('ranks by count, with older uses worth less', () => {
    const usage: EmojiUsage = {
      '👍': { count: 10, last: now - 60 * day },
      '🔥': { count: 4, last: now },
      '😂': { count: 3, last: now },
    };
    expect(topEmojis(usage, now, 2)).toEqual(['🔥', '😂']);
  });

  it('fills quick reactions with the defaults', () => {
    expect(quickReactions({}, now, 4)).toEqual(['👍', '😂', '❤️', '😮']);
    expect(quickReactions({ '🔥': { count: 1, last: now } }, now, 3)).toEqual(['🔥', '👍', '😂']);
  });

  it('keeps a bounded history', () => {
    let usage: EmojiUsage = {};
    for (let i = 0; i < 260; i++) usage = recordUse(usage, `e${i}`, now + i);
    expect(Object.keys(usage).length).toBeLessThanOrEqual(200);
  });
});

describe('shortcodeQueryAt', () => {
  it('needs two letters after a colon at the start or after a space', () => {
    expect(shortcodeQueryAt(':j', 2)).toBeNull();
    expect(shortcodeQueryAt(':jo', 3)).toEqual({ start: 0, query: 'jo', closed: false });
    expect(shortcodeQueryAt('oi :joy', 7)).toEqual({ start: 3, query: 'joy', closed: false });
  });

  it('ignores colons inside words or times', () => {
    expect(shortcodeQueryAt('http://x', 8)).toBeNull();
    expect(shortcodeQueryAt('às 14:30', 8)).toBeNull();
  });

  it('notices a closing colon', () => {
    expect(shortcodeQueryAt('oi :joy:', 8)).toEqual({ start: 3, query: 'joy', closed: true });
  });

  it('only looks before the cursor', () => {
    expect(shortcodeQueryAt(':joy tudo', 4)).toEqual({ start: 0, query: 'joy', closed: false });
  });
});

describe('exactShortcode', () => {
  it('matches a whole shortcode only', () => {
    expect(exactShortcode(catalog, 'joy')?.emoji).toBe('😂');
    expect(exactShortcode(catalog, 'jo')).toBeNull();
  });
});

describe('real catalog', () => {
  it('has every emoji accepted as a reaction by the shared rule', async () => {
    const [compact, github] = await Promise.all([
      import('emojibase-data/pt/compact.json'),
      import('emojibase-data/en/shortcodes/github.json'),
    ]);
    const all = buildCatalog(compact.default as RawEmoji[], github.default as RawShortcodes);
    expect(all.length).toBeGreaterThan(1500);
    expect(all.filter((e) => !isReactionEmoji(e.emoji)).map((e) => e.emoji)).toEqual([]);
    expect(searchEmojis(all, 'joy')[0]?.emoji).toBe('😂');
  });
});
