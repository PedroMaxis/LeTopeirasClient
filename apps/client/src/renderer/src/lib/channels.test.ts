import type { Category, Channel } from '@letopeiras/shared';
import { describe, expect, it } from 'vitest';
import { isUnread, matchScore, normalize, sidebarOrder } from './channels';

const channel = (id: number, name: string, extra: Partial<Channel> = {}): Channel => ({
  id,
  name,
  type: 'text',
  position: id,
  categoryId: null,
  topic: null,
  isPrivate: false,
  roleIds: [],
  lastMessageId: null,
  ...extra,
});

describe('sidebarOrder', () => {
  it('puts uncategorized first, then categories by position, text before voice', () => {
    const categories: Category[] = [
      { id: 1, name: 'B', position: 1 },
      { id: 2, name: 'A', position: 0 },
    ];
    const order = sidebarOrder(
      [
        channel(1, 'voz-b', { categoryId: 1, type: 'voice', position: 0 }),
        channel(2, 'texto-b', { categoryId: 1, position: 5 }),
        channel(3, 'texto-a', { categoryId: 2 }),
        channel(4, 'solto', { categoryId: null }),
      ],
      categories,
    );
    expect(order.map((c) => c.name)).toEqual(['solto', 'texto-a', 'texto-b', 'voz-b']);
  });
});

describe('matchScore', () => {
  const score = (name: string, query: string) => matchScore(normalize(name), normalize(query));

  it('ranks prefix > word start > anywhere > abbreviation', () => {
    expect(score('jogos', 'jo')).toBe(4);
    expect(score('sala-de-jogos', 'jog')).toBe(3);
    expect(score('memes', 'em')).toBe(2);
    expect(score('geral-chat', 'gc')).toBe(1);
    expect(score('geral', 'xyz')).toBe(0);
  });

  it('ignores accents and case', () => {
    expect(score('Música', 'musica')).toBe(4);
  });
});

describe('isUnread', () => {
  it('compares the newest message with the read marker', () => {
    expect(isUnread(channel(1, 'a', { lastMessageId: 10 }), { 1: 9 })).toBe(true);
    expect(isUnread(channel(1, 'a', { lastMessageId: 10 }), { 1: 10 })).toBe(false);
    expect(isUnread(channel(1, 'a', { lastMessageId: 10, type: 'voice' }), {})).toBe(false);
  });
});
