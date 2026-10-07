import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientEventSchema, WsCloseCode } from '@letopeiras/shared';
import { bearer, connect, createTestApp, type TestSocket } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
const sockets: TestSocket[] = [];
const open = async (token?: string) => {
  const socket = await connect(t.app, token);
  sockets.push(socket);
  return socket;
};

beforeEach(async () => (t = await createTestApp()));
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await t.close();
});

describe('handshake', () => {
  it('closes the socket when the first frame is not a valid auth', async () => {
    const ws = await open();
    ws.send({ type: 'message.send', data: { channelId: 1, content: 'oi' } });
    expect(await ws.closed).toBe(WsCloseCode.InvalidMessage);
  });

  it('closes the socket for an invalid token', async () => {
    const ws = await open();
    ws.send({ type: 'auth', data: { token: 'nope' } });
    expect(await ws.closed).toBe(WsCloseCode.Unauthorized);
  });

  it('sends ready with the initial state', async () => {
    const maria = await t.register('maria');
    const ws = await open(maria.token);
    expect(ws.ready).toMatchObject({
      user: { id: maria.user.id, username: 'maria' },
      channels: [
        { id: 1, name: 'geral', type: 'text', categoryId: 1, isPrivate: false, roleIds: [] },
        { id: 2, name: 'Geral', type: 'voice', categoryId: 2, isPrivate: false, roleIds: [] },
      ],
      categories: [
        { id: 1, name: 'Canais de texto', position: 0 },
        { id: 2, name: 'Canais de voz', position: 1 },
      ],
      roles: [],
      presence: [{ userId: maria.user.id, status: 'online' }],
      voiceStates: [],
      readStates: [],
    });
    expect(ws.ready?.users.map((u) => u.username)).toEqual(['admin', 'maria']);
  });

  it('is closed when the session logs out', async () => {
    const maria = await t.register('maria');
    const ws = await open(maria.token);
    await t.app.inject({ method: 'POST', url: '/auth/logout', headers: bearer(maria.token) });
    expect(await ws.closed).toBe(WsCloseCode.SessionRevoked);
  });
});

describe('presence', () => {
  it('announces online once per user and offline when the last socket closes', async () => {
    const maria = await t.register('maria');
    const joao = await t.register('joao');
    const watcher = await open(maria.token);

    const first = await open(joao.token);
    expect((await watcher.next('presence.updated')).data).toEqual({
      userId: joao.user.id,
      status: 'online',
    });
    const second = await open(joao.token);
    expect(await watcher.receives('presence.updated')).toBe(false);

    first.close();
    expect(await watcher.receives('presence.updated')).toBe(false);
    second.close();
    expect((await watcher.next('presence.updated')).data.status).toBe('offline');
  });

  it('announces new users', async () => {
    const maria = await t.register('maria');
    const ws = await open(maria.token);
    const joao = await t.register('joao');
    expect((await ws.next('user.created')).data.user).toEqual(joao.user);
  });
});

describe('chat', () => {
  it('two invited users talk in real time', async () => {
    const maria = await t.register('maria');
    const joao = await t.register('joao');
    const wsMaria = await open(maria.token);
    const wsJoao = await open(joao.token);

    wsMaria.send({
      type: 'message.send',
      data: { channelId: 1, content: ' oi joão ', nonce: 'n1' },
    });
    const toJoao = await wsJoao.next('message.created');
    expect(toJoao.data.message).toMatchObject({
      channelId: 1,
      authorId: maria.user.id,
      content: 'oi joão',
      editedAt: null,
    });
    expect((await wsMaria.next('message.created')).data.nonce).toBe('n1');

    wsJoao.send({ type: 'message.send', data: { channelId: 1, content: 'fala maria' } });
    expect((await wsMaria.next('message.created')).data.message.content).toBe('fala maria');

    // History has both, and the sender's own message counts as read.
    const history = await t.app.inject({
      method: 'GET',
      url: '/channels/1/messages',
      headers: bearer(joao.token),
    });
    expect(history.json().messages.map((m: { content: string }) => m.content)).toEqual([
      'oi joão',
      'fala maria',
    ]);
    const reconnect = await open(maria.token);
    expect(reconnect.ready?.readStates).toEqual([
      { channelId: 1, lastReadMessageId: toJoao.data.message.id },
    ]);
  });

  it('lets only the author edit, and the author or an admin delete', async () => {
    const maria = await t.register('maria');
    const joao = await t.register('joao');
    const admin = await t.login('admin');
    const wsMaria = await open(maria.token);
    const wsJoao = await open(joao.token);
    const wsAdmin = await open(admin.token);

    wsMaria.send({ type: 'message.send', data: { channelId: 1, content: 'original' } });
    const { message } = (await wsJoao.next('message.created')).data;

    wsJoao.send({ type: 'message.edit', data: { messageId: message.id, content: 'hack' } });
    expect((await wsJoao.next('error')).data).toMatchObject({
      code: 'forbidden',
      ref: 'message.edit',
    });
    wsJoao.send({ type: 'message.delete', data: { messageId: message.id } });
    expect((await wsJoao.next('error')).data).toMatchObject({
      code: 'forbidden',
      ref: 'message.delete',
    });

    wsMaria.send({ type: 'message.edit', data: { messageId: message.id, content: 'editada' } });
    const updated = (await wsJoao.next('message.updated')).data.message;
    expect(updated).toMatchObject({ content: 'editada', editedAt: expect.any(Number) });

    wsAdmin.send({ type: 'message.delete', data: { messageId: message.id } });
    expect((await wsJoao.next('message.deleted')).data).toEqual({
      channelId: 1,
      messageId: message.id,
    });
  });

  it('rejects messages to voice or unknown channels', async () => {
    const maria = await t.register('maria');
    const ws = await open(maria.token);
    ws.send({ type: 'message.send', data: { channelId: 2, content: 'oi' } });
    expect((await ws.next('error')).data.code).toBe('not_text_channel');
    ws.send({ type: 'message.send', data: { channelId: 999, content: 'oi' } });
    expect((await ws.next('error')).data.code).toBe('not_found');
  });

  it('rate limits message.send', async () => {
    const maria = await t.register('maria');
    const ws = await open(maria.token);
    for (let i = 0; i < 11; i++) {
      ws.send({ type: 'message.send', data: { channelId: 1, content: `spam ${i}` } });
    }
    expect((await ws.next('error')).data).toMatchObject({
      code: 'rate_limited',
      ref: 'message.send',
    });
  });

  it('broadcasts typing to everyone else, throttled', async () => {
    const maria = await t.register('maria');
    const joao = await t.register('joao');
    const wsMaria = await open(maria.token);
    const wsJoao = await open(joao.token);

    wsMaria.send({ type: 'typing.start', data: { channelId: 1 } });
    wsMaria.send({ type: 'typing.start', data: { channelId: 1 } });
    expect((await wsJoao.next('typing')).data).toEqual({ channelId: 1, userId: maria.user.id });
    expect(await wsJoao.receives('typing')).toBe(false);
    expect(await wsMaria.receives('typing')).toBe(false);
  });

  it('syncs read state to the user’s other sessions only', async () => {
    const maria = await t.register('maria');
    const joao = await t.register('joao');
    const wsJoao = await open(joao.token);
    const laptop = await open(maria.token);
    const desktop = await open(maria.token);

    wsJoao.send({ type: 'message.send', data: { channelId: 1, content: 'leia' } });
    const { message } = (await laptop.next('message.created')).data;

    laptop.send({ type: 'channel.read', data: { channelId: 1, messageId: message.id } });
    expect((await desktop.next('channel.read')).data).toEqual({
      channelId: 1,
      lastReadMessageId: message.id,
    });
    expect(await laptop.receives('channel.read')).toBe(false);
    expect(await wsJoao.receives('channel.read')).toBe(false);

    // Marking an older position doesn't move it back or broadcast.
    laptop.send({ type: 'channel.read', data: { channelId: 1, messageId: message.id } });
    expect(await desktop.receives('channel.read')).toBe(false);
  });
});

describe('protocol validation', () => {
  it('answers malformed frames with an error and keeps the socket open', async () => {
    const maria = await t.register('maria');
    const ws = await open(maria.token);
    for (const frame of [
      'not json',
      { type: 'nope', data: {} },
      { type: 'message.send', data: { channelId: 1, content: '   ' } },
      { type: 'message.send', data: { channelId: 1, content: 'x'.repeat(2001) } },
      { type: 'message.send', data: { channelId: -1, content: 'oi' } },
    ]) {
      ws.send(frame);
      expect((await ws.next('error')).data.code).toBe('invalid_message');
    }
    ws.send({ type: 'typing.start', data: { channelId: 1 } });
    expect(await ws.receives('error')).toBe(false);
  });

  it('accepts every client event shape the schema defines', () => {
    const valid = [
      { type: 'auth', data: { token: 't' } },
      { type: 'message.send', data: { channelId: 1, content: 'oi', nonce: 'n' } },
      { type: 'message.edit', data: { messageId: 1, content: 'oi' } },
      { type: 'message.delete', data: { messageId: 1 } },
      { type: 'typing.start', data: { channelId: 1 } },
      { type: 'channel.read', data: { channelId: 1, messageId: 1 } },
      { type: 'voice.update', data: { muted: true, deafened: false } },
    ];
    for (const event of valid) expect(clientEventSchema.safeParse(event).success).toBe(true);
    expect(clientEventSchema.safeParse({ type: 'auth', data: {} }).success).toBe(false);
  });
});
