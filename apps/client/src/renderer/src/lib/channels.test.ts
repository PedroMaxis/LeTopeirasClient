import type { Category, Channel, Message } from '@letopeiras/shared';
import { describe, expect, it } from 'vitest';
import { isUnread, matchScore, normalize, sidebarOrder, summarizeUnread } from './channels';

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

describe('summarizeUnread', () => {
  const msg = (id: number, authorId: number) => ({ id, authorId }) as Message;
  const list = [msg(10, 2), msg(11, 1), msg(12, 2), msg(13, 3)];

  it("counts others' messages after the marker and finds the first", () => {
    const summary = summarizeUnread(list, true, 10, 1);
    expect(summary.count).toBe(2);
    expect(summary.first?.id).toBe(12);
    expect(summary.more).toBe(false);
  });

  it('says "more" while older pages hide the marker', () => {
    const summary = summarizeUnread(list, true, 5, 1);
    expect(summary.count).toBe(3);
    expect(summary.first).toBeUndefined();
    expect(summary.more).toBe(true);
  });

  it('knows the first unread once the channel start is loaded', () => {
    const summary = summarizeUnread(list, false, 5, 1);
    expect(summary.first?.id).toBe(10);
    expect(summary.more).toBe(false);
  });

  it('is empty when nothing is unread', () => {
    const summary = summarizeUnread(list, true, Number.POSITIVE_INFINITY, 1);
    expect(summary.count).toBe(0);
    expect(summary.first).toBeUndefined();
  });
});
