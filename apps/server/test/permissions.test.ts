import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WsCloseCode, type Category, type Channel, type Role, type User } from '@letopeiras/shared';
import { bearer, connect, createTestApp, PASSWORD, type TestSocket } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
let adminToken: string;
const sockets: TestSocket[] = [];
const open = async (token: string) => {
  const socket = await connect(t.app, token);
  sockets.push(socket);
  return socket;
};

beforeEach(async () => {
  t = await createTestApp();
  adminToken = (await t.login('admin')).token;
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await t.close();
});

const asAdmin = <T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  t.app
    .inject({ method, url, headers: bearer(adminToken), ...(payload ? { payload } : {}) })
    .then((res) => ({
      status: res.statusCode,
      body: res.body ? (res.json() as T) : (undefined as T),
    }));

/** maria has the "VIP" tag; joao has none; both can see a private #vip channel exists. */
async function setupPrivateChannel(type: 'text' | 'voice' = 'text') {
  const maria = await t.register('maria');
  const joao = await t.register('joao');
  const { body: role } = await asAdmin<Role>('POST', '/roles', { name: 'VIP', color: '#F0782A' });
  await asAdmin('PUT', `/users/${maria.user.id}/roles`, { roleIds: [role.id] });
  const { body: channel } = await asAdmin<Channel>('POST', '/channels', {
    name: 'vip',
    type,
    isPrivate: true,
    roleIds: [role.id],
  });
  return { maria, joao, role, channel };
}

describe('tags', () => {
  it('admin creates, edits and assigns tags; colors are normalized', async () => {
    const maria = await t.register('maria');
    const created = await asAdmin<Role>('POST', '/roles', { name: 'Mods', color: '#ABCDEF' });
    expect(created).toMatchObject({
      status: 201,
      body: { name: 'Mods', color: '#abcdef', position: 0 },
    });

    const renamed = await asAdmin<Role>('PATCH', `/roles/${created.body.id}`, {
      name: 'Moderação',
    });
    expect(renamed.body.name).toBe('Moderação');

    const assigned = await asAdmin<User>('PUT', `/users/${maria.user.id}/roles`, {
      roleIds: [created.body.id, 999],
    });
    expect(assigned.body.roleIds).toEqual([created.body.id]);
  });

  it('validates colors and is admin only', async () => {
    expect((await asAdmin('POST', '/roles', { name: 'x', color: 'orange' })).status).toBe(400);
    const maria = await t.register('maria');
    const res = await t.app.inject({
      method: 'POST',
      url: '/roles',
      headers: bearer(maria.token),
      payload: { name: 'x', color: '#000000' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('private channels', () => {
  it('locks content for people without the tag', async () => {
    const { maria, joao, channel } = await setupPrivateChannel();
    const wsMaria = await open(maria.token);
    const wsJoao = await open(joao.token);

    // Both see the channel exists; joao can't read it.
    expect(wsJoao.ready?.channels.find((c) => c.id === channel.id)).toMatchObject({
      isPrivate: true,
      lastMessageId: null,
    });
    const history = await t.app.inject({
      method: 'GET',
      url: `/channels/${channel.id}/messages`,
      headers: bearer(joao.token),
    });
    expect(history.statusCode).toBe(403);

    wsJoao.send({ type: 'message.send', data: { channelId: channel.id, content: 'oi' } });
    expect((await wsJoao.next('error')).data.code).toBe('forbidden');

    wsMaria.send({ type: 'typing.start', data: { channelId: channel.id } });
    wsMaria.send({ type: 'message.send', data: { channelId: channel.id, content: 'segredo' } });
    expect((await wsMaria.next('message.created')).data.message.content).toBe('segredo');
    expect(await wsJoao.receives('message.created')).toBe(false);
    expect(await wsJoao.receives('typing')).toBe(false);
  });

  it('admins always have access', async () => {
    const { channel } = await setupPrivateChannel();
    const res = await t.app.inject({
      method: 'GET',
      url: `/channels/${channel.id}/messages`,
      headers: bearer(adminToken),
    });
    expect(res.statusCode).toBe(200);
  });

  it('only issues voice tokens and voice state to people with access', async () => {
    const { maria, joao, channel } = await setupPrivateChannel('voice');
    const token = (auth: { token: string }) =>
      t.app.inject({
        method: 'POST',
        url: '/voice/token',
        headers: bearer(auth.token),
        payload: { channelId: channel.id },
      });
    expect((await token(maria)).statusCode).toBe(200);
    expect((await token(joao)).statusCode).toBe(403);

    const wsMaria = await open(maria.token);
    const wsJoao = await open(joao.token);
    t.app.ctx.voice.join(channel.id, maria.user.id);
    t.app.ctx.gateway.broadcastVoice([channel.id]);
    expect((await wsMaria.next('voice.state')).data.participants).toHaveLength(1);
    expect(await wsJoao.receives('voice.state')).toBe(false);
  });

  it('losing the tag resyncs the user and drops them from private voice', async () => {
    const { maria, channel } = await setupPrivateChannel('voice');
    const wsMaria = await open(maria.token);
    t.app.ctx.voice.join(channel.id, maria.user.id);

    await asAdmin('PUT', `/users/${maria.user.id}/roles`, { roleIds: [] });
    const ready = (await wsMaria.next('ready')).data;
    expect(ready.user.roleIds).toEqual([]);
    expect(ready.voiceStates).toEqual([]);
    expect(t.app.ctx.voice.get(channel.id).participants).toEqual([]);
  });

  it('making a channel public resyncs everyone', async () => {
    const { joao, channel } = await setupPrivateChannel();
    const wsJoao = await open(joao.token);
    await asAdmin('PATCH', `/channels/${channel.id}`, { isPrivate: false });
    const ready = (await wsJoao.next('ready')).data;
    expect(ready.channels.find((c) => c.id === channel.id)?.isPrivate).toBe(false);
    const history = await t.app.inject({
      method: 'GET',
      url: `/channels/${channel.id}/messages`,
      headers: bearer(joao.token),
    });
    expect(history.statusCode).toBe(200);
  });
});

describe('categories', () => {
  it('admin creates, renames and deletes categories; channels fall back to no category', async () => {
    const maria = await t.register('maria');
    const ws = await open(maria.token);

    const { body: category } = await asAdmin<Category>('POST', '/categories', { name: 'Recepção' });
    expect((await ws.next('category.created')).data.category).toEqual(category);

    const { body: channel } = await asAdmin<Channel>('POST', '/channels', {
      name: 'bem-vindos',
      type: 'text',
      categoryId: category.id,
      topic: 'Leia antes de tudo',
    });
    expect(channel).toMatchObject({ categoryId: category.id, topic: 'Leia antes de tudo' });

    await asAdmin('PATCH', `/categories/${category.id}`, { name: 'RECEPÇÃO' });
    expect((await ws.next('category.updated')).data.category.name).toBe('RECEPÇÃO');

    await asAdmin('DELETE', `/categories/${category.id}`);
    const ready = (await ws.next('ready')).data;
    expect(ready.categories.some((c) => c.id === category.id)).toBe(false);
    expect(ready.channels.find((c) => c.id === channel.id)?.categoryId).toBeNull();
  });

  it('moves channels between categories and clears topics', async () => {
    const { body: channel } = await asAdmin<Channel>('PATCH', '/channels/1', {
      categoryId: null,
      topic: '',
      position: 5,
    });
    expect(channel).toMatchObject({ categoryId: null, topic: null, position: 5 });
    expect((await asAdmin('PATCH', '/channels/1', { categoryId: 999 })).status).toBe(400);
  });
});

describe('profile', () => {
  it('changes the display name and tells everyone', async () => {
    const maria = await t.register('maria');
    const joao = await t.register('joao');
    const wsJoao = await open(joao.token);
    const res = await t.app.inject({
      method: 'PATCH',
      url: '/users/me',
      headers: bearer(maria.token),
      payload: { displayName: 'Maria Clara' },
    });
    expect(res.json<User>().displayName).toBe('Maria Clara');
    expect((await wsJoao.next('user.updated')).data.user.displayName).toBe('Maria Clara');
  });

  it('changes the password and logs out other sessions', async () => {
    const maria = await t.register('maria');
    const other = await t.login('maria');
    const wsOther = await open(other.token);
    const change = (currentPassword: string) =>
      t.app.inject({
        method: 'POST',
        url: '/users/me/password',
        headers: bearer(maria.token),
        payload: { currentPassword, newPassword: 'outra senha forte' },
      });

    const wrong = await change('errada');
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe('wrong_password');

    expect((await change(PASSWORD)).statusCode).toBe(204);
    expect(await wsOther.closed).toBe(WsCloseCode.SessionRevoked);
    expect((await t.login('maria', 'outra senha forte')).token).toEqual(expect.any(String));
    const stillIn = await t.app.inject({
      method: 'GET',
      url: '/channels/1/messages',
      headers: bearer(maria.token),
    });
    expect(stillIn.statusCode).toBe(200);
  });
});

describe('presence', () => {
  it('goes idle only when every connection of the user is idle', async () => {
    const maria = await t.register('maria');
    const joao = await t.register('joao');
    const watcher = await open(joao.token);
    const laptop = await open(maria.token);
    const desktop = await open(maria.token);
    await watcher.next('presence.updated');

    laptop.send({ type: 'presence.update', data: { status: 'idle' } });
    expect(await watcher.receives('presence.updated')).toBe(false);
    desktop.send({ type: 'presence.update', data: { status: 'idle' } });
    expect((await watcher.next('presence.updated')).data).toEqual({
      userId: maria.user.id,
      status: 'idle',
    });
    laptop.send({ type: 'presence.update', data: { status: 'online' } });
    expect((await watcher.next('presence.updated')).data.status).toBe('online');
  });
});
