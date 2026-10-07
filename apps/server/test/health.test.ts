import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@letopeiras/shared';
import { createTestApp } from './helpers';

describe('GET /health', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => (t = await createTestApp()));
  afterAll(() => t.close());

  it('returns a valid health payload', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(healthResponseSchema.safeParse(res.json()).success).toBe(true);
  });

  it('lets the app (another origin) use every method the API needs', async () => {
    const res = await t.app.inject({
      method: 'OPTIONS',
      url: '/users/1/roles',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'PUT' },
    });
    expect(res.statusCode).toBe(204);
    const allowed = String(res.headers['access-control-allow-methods']);
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(allowed).toContain(method);
    }
  });

  it('answers unknown routes with an ApiError', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: expect.any(String) } });
  });
});
