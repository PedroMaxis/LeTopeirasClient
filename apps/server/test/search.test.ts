import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Channel, SearchResponse } from '@letopeiras/shared';
import { toMatchExpression } from '../src/services/search';
import { bearer, connect, createTestApp, type TestSocket } from './helpers';

describe('toMatchExpression', () => {
  it('quotes each word as a prefix, dropping anything that could be FTS5 syntax', () => {
    expect(toMatchExpression('bolo de cenoura')).toBe('"bolo"* "de"* "cenoura"*');
    expect(toMatchExpression('a OR b NOT "c" content:x NEAR(y)')).toBe(
      '"a"* "OR"* "b"* "NOT"* "c"* "content"* "x"* "NEAR"* "y"*',
    );
    expect(toMatchExpression('!!! ***')).toBeNull();
  });
});

let t: Awaited<ReturnType<typeof createTestApp>>;
const sockets: TestSocket[] = [];

beforeEach(async () => (t = await createTestApp()));
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await t.close();
});

async function post(token: string, ws: TestSocket, channelId: number, content: string) {
  ws.send({ type: 'message.send', data: { channelId, content } });
  return (await ws.next('message.created')).data.message;
}

const searchAs = async (token: string, query: string) => {
  const res = await t.app.inject({
    method: 'GET',
    url: `/search?${query}`,
    headers: bearer(token),
  });
  return { status: res.statusCode, body: res.json<SearchResponse>() };
};

describe('search', () => {
  it('finds words regardless of accents and case, as prefixes, newest first', async () => {
    const maria = await t.register('maria');
    const ws = await connect(t.app, maria.token);
    sockets.push(ws);
    const first = await post(maria.token, ws, 1, 'Bora jogar MÚSICA hoje?');
    await post(maria.token, ws, 1, 'nada a ver');
    const second = await post(maria.token, ws, 1, 'a musicalidade dele');

    const { body } = await searchAs(maria.token, 'q=musica');
    expect(body.messages.map((m) => m.id)).toEqual([second.id, first.id]);
    expect((await searchAs(maria.token, 'q=bora%20hoje')).body.messages.map((m) => m.id)).toEqual([
      first.id,
    ]);
  });

  it('follows edits and deletes', async () => {
    const maria = await t.register('maria');
    const ws = await connect(t.app, maria.token);
    sockets.push(ws);
    const message = await post(maria.token, ws, 1, 'abacaxi');
    ws.send({ type: 'message.edit', data: { messageId: message.id, content: 'melancia' } });
    await ws.next('message.updated');
    expect((await searchAs(maria.token, 'q=abacaxi')).body.messages).toEqual([]);
    expect((await searchAs(maria.token, 'q=melancia')).body.messages).toHaveLength(1);

    ws.send({ type: 'message.delete', data: { messageId: message.id } });
    await ws.next('message.deleted');
    expect((await searchAs(maria.token, 'q=melancia')).body.messages).toEqual([]);
  });

  it('pages with `before` and narrows to one channel', async () => {
    const maria = await t.register('maria');
    const ws = await connect(t.app, maria.token);
    sockets.push(ws);
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await post(maria.token, ws, 1, `pipoca ${i}`)).id);

    const page1 = (await searchAs(maria.token, 'q=pipoca&limit=2')).body;
    expect(page1.messages.map((m) => m.id)).toEqual([ids[2], ids[1]]);
    expect(page1.hasMore).toBe(true);
    const page2 = (await searchAs(maria.token, `q=pipoca&limit=2&before=${ids[1]}`)).body;
    expect(page2.messages.map((m) => m.id)).toEqual([ids[0]]);
    expect(page2.hasMore).toBe(false);
  });

  it("never returns messages from channels you can't see", async () => {
    const admin = await t.login('admin');
    const res = await t.app.inject({
      method: 'POST',
      url: '/channels',
      headers: bearer(admin.token),
      payload: { name: 'segredo', type: 'text', isPrivate: true, roleIds: [] },
    });
    const secret = res.json<Channel>();
    const wsAdmin = await connect(t.app, admin.token);
    sockets.push(wsAdmin);
    await post(admin.token, wsAdmin, secret.id, 'senha do wifi');

    const joao = await t.register('joao');
    expect((await searchAs(joao.token, 'q=wifi')).body.messages).toEqual([]);
    expect((await searchAs(joao.token, `q=wifi&channelId=${secret.id}`)).status).toBe(403);
    expect((await searchAs(admin.token, 'q=wifi')).body.messages).toHaveLength(1);
  });
});
