import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createTestApp, multipartFile } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeEach(async () => (t = await createTestApp()));
afterEach(() => t.close());

const png = (w = 600, h = 400) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#2a64a3' } })
    .png()
    .toBuffer();

const upload = async (token: string, data: Buffer, type = 'image/png') => {
  const { payload, headers } = multipartFile(data, 'x.png', type);
  return t.app.inject({
    method: 'POST',
    url: '/uploads',
    headers: { ...headers, ...bearer(token) },
    payload,
  });
};

describe('POST /uploads', () => {
  it('stores a WebP and returns its url and size', async () => {
    const { token } = await t.login('admin');
    const res = await upload(token, await png());
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ width: 600, height: 400 });
    expect(body.url).toMatch(/^\/files\/[0-9a-f]{64}\.webp$/);

    const file = await t.app.inject({ method: 'GET', url: body.url });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/webp');
    expect(file.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await sharp(file.rawPayload).metadata()).format).toBe('webp');
  });

  it('refuses files over 10 MB', async () => {
    const { token } = await t.login('admin');
    const res = await upload(token, Buffer.alloc(10 * 1024 * 1024 + 1));
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('file_too_large');
  });

  it('refuses non-images whatever the content type says', async () => {
    const { token } = await t.login('admin');
    const res = await upload(token, Buffer.from('hello'), 'image/png');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_image');
  });

  it('requires a session', async () => {
    const { payload, headers } = multipartFile(await png());
    const res = await t.app.inject({ method: 'POST', url: '/uploads', headers, payload });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /files/:name', () => {
  it('404s for unknown or malformed names', async () => {
    expect(
      (await t.app.inject({ method: 'GET', url: `/files/${'a'.repeat(64)}.webp` })).statusCode,
    ).toBe(404);
    expect(
      (await t.app.inject({ method: 'GET', url: '/files/..%2F..%2Fetc%2Fpasswd' })).statusCode,
    ).toBe(404);
  });
});
