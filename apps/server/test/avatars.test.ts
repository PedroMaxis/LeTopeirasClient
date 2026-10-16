import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStore, hashFromUrl } from '../src/services/files';
import { bearer, connect, createTestApp, multipartFile } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeEach(async () => (t = await createTestApp()));
afterEach(() => t.close());

const image = (color: string) =>
  sharp({ create: { width: 900, height: 500, channels: 3, background: color } })
    .jpeg()
    .toBuffer();

const setAvatar = async (token: string, data: Buffer) => {
  const { payload, headers } = multipartFile(data, 'me.jpg', 'image/jpeg');
  return t.app.inject({
    method: 'PUT',
    url: '/users/me/avatar',
    headers: { ...headers, ...bearer(token) },
    payload,
  });
};

describe('avatar', () => {
  it('sets a 256×256 WebP and tells everyone', async () => {
    const member = await t.register('maria');
    const other = await connect(t.app, (await t.login('admin')).token);
    const res = await setAvatar(member.token, await image('#a3305f'));
    expect(res.statusCode).toBe(200);
    const url: string = res.json().avatarUrl;
    expect(url).toMatch(/^\/files\/[0-9a-f]{64}\.webp$/);
    const updated = await other.next('user.updated');
    expect(updated.data.user.avatarUrl).toBe(url);
    const file = await t.app.inject({ method: 'GET', url });
    const meta = await sharp(file.rawPayload).metadata();
    expect([meta.width, meta.height]).toEqual([256, 256]);
    other.close();
  });

  it('accepts inputs above the 10 MB chat limit', async () => {
    const member = await t.register('maria');
    const big = await sharp({
      // 2500×2000×3 uncompressed ≈ 15 MB: over the chat limit, under the 25 MB avatar limit.
      create: {
        width: 2500,
        height: 2000,
        channels: 3,
        background: '#808080', // required by the type; the noise replaces it
        noise: { type: 'gaussian', mean: 128, sigma: 60 },
      },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    expect(big.length).toBeGreaterThan(10 * 1024 * 1024);
    expect((await setAvatar(member.token, big)).statusCode).toBe(200);
  });

  it('replacing or removing deletes the old file', async () => {
    const member = await t.register('maria');
    const first = (await setAvatar(member.token, await image('#111'))).json().avatarUrl;
    const hash = hashFromUrl(first);
    if (!hash) throw new Error('avatar url has no hash');
    const path = new FileStore(t.uploadsDir).pathOf(hash);
    expect(existsSync(path)).toBe(true);
    await setAvatar(member.token, await image('#eee'));
    expect(existsSync(path)).toBe(false);

    const res = await t.app.inject({
      method: 'DELETE',
      url: '/users/me/avatar',
      headers: bearer(member.token),
    });
    expect(res.json().avatarUrl).toBeNull();
  });
});
