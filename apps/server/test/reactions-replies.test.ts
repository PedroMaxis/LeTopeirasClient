import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isReactionEmoji, LIMITS, type Channel } from '@letopeiras/shared';
import { addReaction } from '../src/repo/messages';
import { bearer, connect, createTestApp, type TestSocket } from './helpers';

describe('isReactionEmoji', () => {
  it('accepts single emojis, composite ones included', () => {
    for (const emoji of ['👍', '👍🏽', '❤️', '👨‍👩‍👧', '1️⃣', '🇧🇷', '⛏️']) {
      expect(isReactionEmoji(emoji), emoji).toBe(true);
    }
  });

  it('rejects text, several emojis and markup', () => {
    for (const text of ['a', '1', '👍👍', ' ', '<b>', '👍 ', '']) {
      expect(isReactionEmoji(text), JSON.stringify(text)).toBe(false);
    }
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

/** maria and joao connected; maria posted "oi" in #geral. */
async function setup() {
  const maria = await t.register('maria');
  const joao = await t.register('joao');
  const wsMaria = await open(maria.token);
  const wsJoao = await open(joao.token);
  wsMaria.send({ type: 'message.send', data: { channelId: 1, content: 'oi' } });
  const { message } = (await wsJoao.next('message.created')).data;
  await wsMaria.next('message.created');
  return { maria, joao, wsMaria, wsJoao, message };
}

describe('reactions', () => {
  it('adds, groups and removes reactions, and shows them in the history', async () => {
    const { maria, joao, wsMaria, wsJoao, message } = await setup();

    wsJoao.send({ type: 'reaction.add', data: { messageId: message.id, emoji: '👍' } });
    expect((await wsMaria.next('message.reactions')).data).toEqual({
      channelId: 1,
      messageId: message.id,
      reactions: [{ emoji: '👍', userIds: [joao.user.id] }],
    });
    await wsJoao.next('message.reactions'); // his own, echoed back
    wsMaria.send({ type: 'reaction.add', data: { messageId: message.id, emoji: '👍' } });
    wsMaria.send({ type: 'reaction.add', data: { messageId: message.id, emoji: '🔥' } });
    await wsJoao.next('message.reactions');
    const { reactions } = (await wsJoao.next('message.reactions')).data;
    expect(reactions).toEqual([
      { emoji: '👍', userIds: [joao.user.id, maria.user.id] },
      { emoji: '🔥', userIds: [maria.user.id] },
    ]);

    await wsMaria.next('message.reactions'); // her own two, echoed back
    await wsMaria.next('message.reactions');
    // Reacting twice changes nothing, so nothing is broadcast.
    wsJoao.send({ type: 'reaction.add', data: { messageId: message.id, emoji: '👍' } });
    expect(await wsMaria.receives('message.reactions')).toBe(false);

    wsJoao.send({ type: 'reaction.remove', data: { messageId: message.id, emoji: '👍' } });
    expect((await wsMaria.next('message.reactions')).data.reactions[0]).toEqual({
      emoji: '👍',
      userIds: [maria.user.id],
    });

    const history = await t.app.inject({
      method: 'GET',
      url: '/channels/1/messages',
      headers: bearer(joao.token),
    });
    expect(history.json<{ messages: { reactions: unknown }[] }>().messages[0]?.reactions).toEqual([
      { emoji: '👍', userIds: [maria.user.id] },
      { emoji: '🔥', userIds: [maria.user.id] },
    ]);
  });

  it('rejects non-emojis and too many different emojis', async () => {
    const { wsJoao, message } = await setup();
    wsJoao.send({ type: 'reaction.add', data: { messageId: message.id, emoji: 'lol' } });
    expect((await wsJoao.next('error')).data.code).toBe('invalid_emoji');

    // Straight into the database: 20 reactions over the socket would hit the rate limit.
    const emojis = [...'😀😃😄😁😆😅😂🤣🙂😉😊😍🥰😘😎🤩🥳😏😴🤔🤨'];
    for (const emoji of emojis.slice(0, LIMITS.reactionsPerMessage)) {
      addReaction(t.db, message.id, t.admin.id, emoji);
    }
    wsJoao.send({ type: 'reaction.add', data: { messageId: message.id, emoji: '🤨' } });
    expect((await wsJoao.next('error')).data.code).toBe('too_many_reactions');
  });

  it("doesn't reach people who can't see the channel", async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/channels',
      headers: bearer((await t.login('admin')).token),
      payload: { name: 'segredo', type: 'text', isPrivate: true, roleIds: [] },
    });
    const secret = res.json<Channel>();
    const admin = await open((await t.login('admin')).token);
    const joao = await t.register('joao');
    const wsJoao = await open(joao.token);

    admin.send({ type: 'message.send', data: { channelId: secret.id, content: 'shh' } });
    const { message } = (await admin.next('message.created')).data;
    wsJoao.send({ type: 'reaction.add', data: { messageId: message.id, emoji: '👀' } });
    expect((await wsJoao.next('error')).data.code).toBe('forbidden');

    admin.send({ type: 'reaction.add', data: { messageId: message.id, emoji: '👀' } });
    await admin.next('message.reactions');
    expect(await wsJoao.receives('message.reactions')).toBe(false);
  });
});

describe('replies', () => {
  it('quotes the original and pings its author unless turned off', async () => {
    const { maria, joao, wsMaria, wsJoao, message } = await setup();

    wsJoao.send({
      type: 'message.send',
      data: { channelId: 1, content: 'tchau', replyToId: message.id },
    });
    const reply = (await wsMaria.next('message.created')).data.message;
    expect(reply.replyToId).toBe(message.id);
    expect(reply.replyTo).toEqual({ authorId: maria.user.id, content: 'oi' });
    expect(reply.mentionIds).toEqual([maria.user.id]);

    wsJoao.send({
      type: 'message.send',
      data: { channelId: 1, content: 'quieto', replyToId: message.id, replyPing: false },
    });
    expect((await wsMaria.next('message.created')).data.message.mentionIds).toEqual([]);

    // Replying to yourself never pings.
    wsJoao.send({
      type: 'message.send',
      data: { channelId: 1, content: 'eu', replyToId: reply.id },
    });
    const own = (await wsMaria.next('message.created')).data.message;
    expect(own).toMatchObject({ authorId: joao.user.id, replyToId: reply.id, mentionIds: [] });
  });

  it('keeps the reply when the original is deleted, without the snippet', async () => {
    const { wsMaria, wsJoao, message, joao } = await setup();
    wsJoao.send({
      type: 'message.send',
      data: { channelId: 1, content: 'resposta', replyToId: message.id },
    });
    await wsMaria.next('message.created');
    wsMaria.send({ type: 'message.delete', data: { messageId: message.id } });
    await wsJoao.next('message.deleted');

    const history = await t.app.inject({
      method: 'GET',
      url: '/channels/1/messages',
      headers: bearer(joao.token),
    });
    const [kept] = history.json<{ messages: { replyToId: number; replyTo: unknown }[] }>().messages;
    expect(kept).toMatchObject({ replyToId: message.id, replyTo: null });
  });

  it('only replies within the same channel', async () => {
    const { wsJoao, message } = await setup();
    const res = await t.app.inject({
      method: 'POST',
      url: '/channels',
      headers: bearer((await t.login('admin')).token),
      payload: { name: 'outro', type: 'text', isPrivate: false, roleIds: [] },
    });
    const other = res.json<Channel>();
    wsJoao.send({
      type: 'message.send',
      data: { channelId: other.id, content: 'x', replyToId: message.id },
    });
    expect((await wsJoao.next('error')).data.code).toBe('not_found');
  });
});
