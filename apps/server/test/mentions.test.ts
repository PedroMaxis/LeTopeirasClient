import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mentionsEveryone, parseMentions, type Channel, type Role } from '@letopeiras/shared';
import { bearer, connect, createTestApp, type TestSocket } from './helpers';

describe('parseMentions', () => {
  it('finds usernames, case-insensitively and once each', () => {
    expect(parseMentions('oi @Maria e @joao, cadê @maria?')).toEqual(['maria', 'joao']);
  });

  it('treats @todos as everyone, not as a username', () => {
    expect(parseMentions('@todos bora @maria')).toEqual(['maria']);
    expect(mentionsEveryone('bora, @Todos!')).toBe(true);
    expect(mentionsEveryone('todos@gmail.com @todosx')).toBe(false);
  });

  it('ignores e-mails, short names and trailing dots', () => {
    expect(parseMentions('manda pra pedro@gmail.com @ab @x.y fala @maria.')).toEqual([
      'x.y',
      'maria',
    ]);
  });
});

let t: Awaited<ReturnType<typeof createTestApp>>;
const sockets: TestSocket[] = [];
const open = async (token: string) => {
  const socket = await connect(t.app, token);
  sockets.push(socket);
  return socket;
};

beforeEach(async () => (t = await createTestApp()));
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await t.close();
});

describe('mentions', () => {
  it('marks mentioned users on the message and counts them as unread', async () => {
    const maria = await t.register('maria');
    const joao = await t.register('joao');
    const wsMaria = await open(maria.token);
    const wsJoao = await open(joao.token);

    wsMaria.send({
      type: 'message.send',
      data: { channelId: 1, content: 'ei @JOAO, bora? e @ninguem e @maria' },
    });
    const { message } = (await wsJoao.next('message.created')).data;
    // Unknown users and the author herself aren't mentions.
    expect(message.mentionIds).toEqual([joao.user.id]);

    const reconnect = await open(joao.token);
    expect(reconnect.ready?.mentions).toEqual([{ channelId: 1, count: 1 }]);

    wsJoao.send({ type: 'channel.read', data: { channelId: 1, messageId: message.id } });
    await wsJoao.receives('channel.read');
    const afterRead = await open(joao.token);
    expect(afterRead.ready?.mentions).toEqual([]);
  });

  it('recomputes mentions when the message is edited', async () => {
    const maria = await t.register('maria');
    const joao = await t.register('joao');
    const wsMaria = await open(maria.token);

    wsMaria.send({ type: 'message.send', data: { channelId: 1, content: 'oi @joao' } });
    const { message } = (await wsMaria.next('message.created')).data;
    wsMaria.send({ type: 'message.edit', data: { messageId: message.id, content: 'oi galera' } });
    expect((await wsMaria.next('message.updated')).data.message.mentionIds).toEqual([]);

    const history = await t.app.inject({
      method: 'GET',
      url: '/channels/1/messages',
      headers: bearer(joao.token),
    });
    expect(history.json().messages[0].mentionIds).toEqual([]);
  });

  it("doesn't mention people who can't see a private channel", async () => {
    const maria = await t.register('maria');
    const joao = await t.register('joao');
    const admin = (await t.login('admin')).token;
    const asAdmin = (method: 'POST' | 'PUT', url: string, payload: object) =>
      t.app.inject({ method, url, headers: bearer(admin), payload });

    const role = (await asAdmin('POST', '/roles', { name: 'VIP', color: '#f0782a' })).json<Role>();
    await asAdmin('PUT', `/users/${maria.user.id}/roles`, { roleIds: [role.id] });
    const channel = (
      await asAdmin('POST', '/channels', {
        name: 'vip',
        type: 'text',
        isPrivate: true,
        roleIds: [role.id],
      })
    ).json<Channel>();

    const wsMaria = await open(maria.token);
    wsMaria.send({
      type: 'message.send',
      data: { channelId: channel.id, content: '@joao e @admin olhem isso' },
    });
    const { message } = (await wsMaria.next('message.created')).data;
    expect(message.mentionIds).toEqual([t.admin.id]);

    const wsJoao = await open(joao.token);
    expect(wsJoao.ready?.mentions).toEqual([]);
  });

  it('@todos counts as a mention for everyone who can see the channel', async () => {
    const maria = await t.register('maria');
    const joao = await t.register('joao');
    const wsMaria = await open(maria.token);

    wsMaria.send({
      type: 'message.send',
      data: { channelId: 1, content: '@todos partida às 22h' },
    });
    const { message } = (await wsMaria.next('message.created')).data;
    expect(message).toMatchObject({ mentionsEveryone: true, mentionIds: [] });

    expect((await open(joao.token)).ready?.mentions).toEqual([{ channelId: 1, count: 1 }]);
    // The author isn't notified by her own @todos.
    expect((await open(maria.token)).ready?.mentions).toEqual([]);

    wsMaria.send({
      type: 'message.edit',
      data: { messageId: message.id, content: 'partida às 22h' },
    });
    expect((await wsMaria.next('message.updated')).data.message.mentionsEveryone).toBe(false);
    expect((await open(joao.token)).ready?.mentions).toEqual([]);
  });

  it('reserves the "todos" username', async () => {
    const admin = await t.login('admin');
    const { code } = (
      await t.app.inject({ method: 'POST', url: '/invites', headers: bearer(admin.token) })
    ).json<{ code: string }>();
    const res = await t.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        inviteCode: code,
        username: 'Todos',
        displayName: 'Todos',
        password: 'senha forte 1',
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
