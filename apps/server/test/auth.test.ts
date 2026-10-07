import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authResponseSchema, type AuthResponse, type InviteResponse } from '@letopeiras/shared';
import { createInvite } from '../src/repo/invites';
import { bearer, createTestApp, PASSWORD } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeEach(async () => (t = await createTestApp()));
afterEach(() => t.close());

const registerWith = (inviteCode: string, username = 'joao') =>
  t.app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { inviteCode, username, displayName: 'João', password: PASSWORD },
  });

describe('POST /auth/register', () => {
  it('creates a user with a valid invite and returns a session', async () => {
    const { code } = createInvite(t.db, t.admin.id, 60_000);
    const res = await registerWith(code.toLowerCase(), '  Joao  ');
    expect(res.statusCode).toBe(201);
    const body = authResponseSchema.parse(res.json());
    expect(body.user).toMatchObject({ username: 'joao', displayName: 'João', isAdmin: false });
    expect(res.body).not.toContain('password');
  });

  it('rejects unknown, used and expired invites', async () => {
    expect((await registerWith('NOPE')).json().error.code).toBe('invalid_invite');

    const { code } = createInvite(t.db, t.admin.id, 60_000);
    expect((await registerWith(code, 'first')).statusCode).toBe(201);
    expect((await registerWith(code, 'second')).json().error.code).toBe('invalid_invite');

    const expired = createInvite(t.db, t.admin.id, -1);
    expect((await registerWith(expired.code)).json().error.code).toBe('invalid_invite');
  });

  it('does not burn the invite when the username is taken', async () => {
    const { code } = createInvite(t.db, t.admin.id, 60_000);
    const res = await registerWith(code, 'admin');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('username_taken');
    expect((await registerWith(code, 'other')).statusCode).toBe(201);
  });

  it('validates the payload', async () => {
    const { code } = createInvite(t.db, t.admin.id, 60_000);
    const res = await t.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { inviteCode: code, username: 'a b', displayName: 'x', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });
});

describe('POST /auth/login', () => {
  it('returns a session for the right password', async () => {
    const body = await t.login('admin');
    expect(body.user.isAdmin).toBe(true);
    expect(body.token).toEqual(expect.any(String));
  });

  it('gives the same error for a wrong password and an unknown user', async () => {
    const wrong = await t.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'admin', password: 'wrong password' },
    });
    const unknown = await t.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'ghost', password: 'wrong password' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('is rate limited per IP', async () => {
    const attempt = () =>
      t.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: 'ghost', password: 'x' },
      });
    for (let i = 0; i < 10; i++) expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(429);
  });
});

describe('sessions', () => {
  it('rejects requests without a valid token', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/invites', headers: bearer('nope') });
    expect(res.statusCode).toBe(401);
  });

  it('logout revokes the token', async () => {
    const { token } = await t.login('admin');
    const logout = await t.app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: bearer(token),
    });
    expect(logout.statusCode).toBe(204);
    const after = await t.app.inject({ method: 'POST', url: '/invites', headers: bearer(token) });
    expect(after.statusCode).toBe(401);
  });

  it('stores only the token hash', async () => {
    const { token } = await t.login('admin');
    const rows = t.db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
    expect(rows.some((r) => r.token_hash === token)).toBe(false);
  });
});

describe('POST /invites', () => {
  it('lets the admin create an invite that works for registering', async () => {
    const { token } = await t.login('admin');
    const res = await t.app.inject({
      method: 'POST',
      url: '/invites',
      headers: bearer(token),
      payload: { expiresInHours: 2 },
    });
    expect(res.statusCode).toBe(201);
    const invite = res.json<InviteResponse>();
    expect(invite.expiresAt).toBeGreaterThan(Date.now() + 60 * 60 * 1000);
    expect((await registerWith(invite.code)).statusCode).toBe(201);
  });

  it('works without a body', async () => {
    const { token } = await t.login('admin');
    const res = await t.app.inject({ method: 'POST', url: '/invites', headers: bearer(token) });
    expect(res.statusCode).toBe(201);
  });

  it('is forbidden for members', async () => {
    const member: AuthResponse = await t.register('maria');
    const res = await t.app.inject({
      method: 'POST',
      url: '/invites',
      headers: bearer(member.token),
    });
    expect(res.statusCode).toBe(403);
  });
});
