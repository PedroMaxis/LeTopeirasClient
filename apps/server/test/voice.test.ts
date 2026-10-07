import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { voiceTokenResponseSchema } from '@letopeiras/shared';
import { AccessToken, TokenVerifier } from 'livekit-server-sdk';
import { bearer, connect, createTestApp, testConfig } from './helpers';

const { apiKey, apiSecret } = testConfig.livekit;

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeEach(async () => (t = await createTestApp()));
afterEach(() => t.close());

describe('POST /voice/token', () => {
  const requestToken = (token: string, channelId: number) =>
    t.app.inject({
      method: 'POST',
      url: '/voice/token',
      headers: bearer(token),
      payload: { channelId },
    });

  it('issues a LiveKit token for the voice room with the user as identity', async () => {
    const member = await t.register('maria');
    const res = await requestToken(member.token, 2);
    expect(res.statusCode).toBe(200);
    const body = voiceTokenResponseSchema.parse(res.json());
    expect(body.url).toBe(testConfig.livekit.url);

    const claims = await new TokenVerifier(apiKey, apiSecret).verify(body.token);
    expect(claims.sub).toBe(String(member.user.id));
    expect(claims.name).toBe(member.user.displayName);
    expect(claims.video).toMatchObject({
      room: 'voice:2',
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });
  });

  it('only works for existing voice channels', async () => {
    const { token } = await t.login('admin');
    expect((await requestToken(token, 1)).json().error.code).toBe('not_voice_channel');
    expect((await requestToken(token, 999)).statusCode).toBe(404);
  });

  it('requires a session', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/voice/token',
      payload: { channelId: 2 },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /livekit/webhook', () => {
  const signedWebhook = async (event: object, secret = apiSecret) => {
    const body = JSON.stringify(event);
    const at = new AccessToken(apiKey, secret);
    at.sha256 = createHash('sha256').update(body).digest('base64');
    return t.app.inject({
      method: 'POST',
      url: '/livekit/webhook',
      headers: { 'content-type': 'application/webhook+json', authorization: await at.toJwt() },
      payload: body,
    });
  };
  const joined = (room: string, identity: string) => ({
    event: 'participant_joined',
    room: { name: room },
    participant: { identity },
  });

  it('tracks joins, screen shares and leaves, broadcasting voice.state', async () => {
    const member = await t.register('maria');
    const ws = await connect(t.app, member.token);
    const identity = String(member.user.id);
    const room = { name: 'voice:2' };

    expect((await signedWebhook(joined('voice:2', identity))).statusCode).toBe(200);
    expect((await ws.next('voice.state')).data).toEqual({
      channelId: 2,
      participants: [
        { userId: member.user.id, muted: false, deafened: false, screenSharing: false },
      ],
    });

    await signedWebhook({
      event: 'track_published',
      room,
      participant: { identity },
      track: { source: 'SCREEN_SHARE' },
    });
    expect((await ws.next('voice.state')).data.participants[0]?.screenSharing).toBe(true);

    ws.send({ type: 'voice.update', data: { muted: true, deafened: false } });
    expect((await ws.next('voice.state')).data.participants[0]?.muted).toBe(true);

    await signedWebhook({ event: 'participant_left', room, participant: { identity } });
    expect((await ws.next('voice.state')).data.participants).toEqual([]);
    ws.close();
  });

  it('ignores rooms and identities that are not ours', async () => {
    const member = await t.register('maria');
    const ws = await connect(t.app, member.token);
    // #geral is a text channel, 999 is not a user, "other" is not a voice room.
    await signedWebhook(joined('voice:1', String(member.user.id)));
    await signedWebhook(joined('voice:2', '999'));
    await signedWebhook(joined('other', String(member.user.id)));
    expect(await ws.receives('voice.state')).toBe(false);
    expect(t.app.ctx.voice.all()).toEqual([]);
    ws.close();
  });

  it('rejects unsigned or wrongly signed webhooks', async () => {
    const event = joined('voice:2', String(t.admin.id));
    const wrongSecret = await signedWebhook(event, 'wrong-secret-that-is-long-enough-for-hs256');
    expect(wrongSecret.statusCode).toBe(401);
    const unsigned = await t.app.inject({
      method: 'POST',
      url: '/livekit/webhook',
      headers: { 'content-type': 'application/webhook+json' },
      payload: JSON.stringify(event),
    });
    expect(unsigned.statusCode).toBe(401);
    expect(t.app.ctx.voice.all()).toEqual([]);
  });
});
