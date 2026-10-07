import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { messageHistoryResponseSchema, type Channel } from '@letopeiras/shared';
import { createMessage } from '../src/repo/messages';
import { bearer, connect, createTestApp } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
let adminToken: string;
beforeEach(async () => {
  t = await createTestApp();
  adminToken = (await t.login('admin')).token;
});
afterEach(() => t.close());

describe('channel CRUD', () => {
  it('lets the admin create, rename and delete channels, broadcasting each change', async () => {
    const member = await t.register('maria');
    const ws = await connect(t.app, member.token);

    const created = await t.app.inject({
      method: 'POST',
      url: '/channels',
      headers: bearer(adminToken),
      payload: { name: 'memes', type: 'text' },
    });
    expect(created.statusCode).toBe(201);
    const channel = created.json<Channel>();
    expect(channel).toMatchObject({
      name: 'memes',
      type: 'text',
      position: 2,
      lastMessageId: null,
    });
    expect((await ws.next('channel.created')).data.channel).toEqual(channel);

    const renamed = await t.app.inject({
      method: 'PATCH',
      url: `/channels/${channel.id}`,
      headers: bearer(adminToken),
      payload: { name: 'memes-2' },
    });
    expect(renamed.json<Channel>().name).toBe('memes-2');
    expect((await ws.next('channel.updated')).data.channel.name).toBe('memes-2');

    const deleted = await t.app.inject({
      method: 'DELETE',
      url: `/channels/${channel.id}`,
      headers: bearer(adminToken),
    });
    expect(deleted.statusCode).toBe(204);
    expect((await ws.next('channel.deleted')).data.channelId).toBe(channel.id);
    ws.close();
  });

  it('is admin only', async () => {
    const member = await t.register('maria');
    const requests = [
      { method: 'POST' as const, url: '/channels', payload: { name: 'x', type: 'text' } },
      { method: 'PATCH' as const, url: '/channels/1', payload: { name: 'x' } },
      { method: 'DELETE' as const, url: '/channels/1' },
    ];
    for (const req of requests) {
      const res = await t.app.inject({ ...req, headers: bearer(member.token) });
      expect(res.statusCode).toBe(403);
    }
  });

  it('returns 404 for unknown channels and 400 for bad ids', async () => {
    const patch = (url: string) =>
      t.app.inject({ method: 'PATCH', url, headers: bearer(adminToken), payload: { name: 'x' } });
    expect((await patch('/channels/999')).statusCode).toBe(404);
    expect((await patch('/channels/abc')).statusCode).toBe(400);
  });
});

describe('GET /channels/:id/messages', () => {
  const history = (query = '', channelId = 1) =>
    t.app.inject({
      method: 'GET',
      url: `/channels/${channelId}/messages${query}`,
      headers: bearer(adminToken),
    });

  it('pages backwards with `before`, oldest → newest within a page', async () => {
    const ids = Array.from(
      { length: 5 },
      (_, i) => createMessage(t.db, { channelId: 1, authorId: t.admin.id, content: `m${i}` }).id,
    );

    const first = messageHistoryResponseSchema.parse((await history('?limit=2')).json());
    expect(first.messages.map((m) => m.content)).toEqual(['m3', 'm4']);
    expect(first.hasMore).toBe(true);

    const second = messageHistoryResponseSchema.parse(
      (await history(`?limit=2&before=${first.messages[0]?.id}`)).json(),
    );
    expect(second.messages.map((m) => m.content)).toEqual(['m1', 'm2']);

    const last = messageHistoryResponseSchema.parse(
      (await history(`?limit=2&before=${ids[1]}`)).json(),
    );
    expect(last).toMatchObject({ hasMore: false, messages: [{ content: 'm0' }] });
  });

  it('validates the query and the channel type', async () => {
    expect((await history('?limit=1000')).statusCode).toBe(400);
    expect((await history('', 2)).json().error.code).toBe('not_text_channel');
    expect((await history('', 999)).statusCode).toBe(404);
  });

  it('requires a session', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/channels/1/messages' });
    expect(res.statusCode).toBe(401);
  });
});
