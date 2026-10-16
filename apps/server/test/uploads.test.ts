import { existsSync } from 'node:fs';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStore, hashFromUrl } from '../src/services/files';
import { bearer, connect, createTestApp, multipartFile } from './helpers';

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

describe('message.send with images', () => {
  const uploadId = async (token: string, color = '#2a64a3') => {
    const data = await sharp({ create: { width: 64, height: 64, channels: 3, background: color } })
      .png()
      .toBuffer();
    return (await upload(token, data)).json() as { id: number; url: string };
  };

  it('sends images without text, in order', async () => {
    const { token } = await t.login('admin');
    const ws = await connect(t.app, token);
    const a = await uploadId(token, '#111');
    const b = await uploadId(token, '#222');
    ws.send({
      type: 'message.send',
      data: { channelId: 1, content: '', attachmentIds: [b.id, a.id] },
    });
    const { message } = (await ws.next('message.created')).data;
    expect(message.content).toBe('');
    expect(message.attachments.map((x) => x.id)).toEqual([b.id, a.id]);
    const page = await t.app.inject({
      method: 'GET',
      url: '/channels/1/messages',
      headers: bearer(token),
    });
    expect(page.json().messages[0].attachments).toHaveLength(2);
    ws.close();
  });

  it('refuses an empty message', async () => {
    const { token } = await t.login('admin');
    const ws = await connect(t.app, token);
    ws.send({ type: 'message.send', data: { channelId: 1, content: '  ' } });
    expect((await ws.next('error')).data.code).toBe('empty_message');
    ws.close();
  });

  it('refuses more than 4 images', async () => {
    const { token } = await t.login('admin');
    const ws = await connect(t.app, token);
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await uploadId(token, `#00000${i}`)).id);
    ws.send({ type: 'message.send', data: { channelId: 1, content: 'oi', attachmentIds: ids } });
    expect((await ws.next('error')).data.ref).toBe('message.send');
    ws.close();
  });

  it("refuses someone else's upload or one already sent", async () => {
    const admin = await t.login('admin');
    const maria = await t.register('maria');
    const ws = await connect(t.app, maria.token);
    const theirs = await uploadId(admin.token);
    ws.send({
      type: 'message.send',
      data: { channelId: 1, content: '', attachmentIds: [theirs.id] },
    });
    expect((await ws.next('error')).data.code).toBe('attachment_not_found');

    const mine = await uploadId(maria.token);
    ws.send({
      type: 'message.send',
      data: { channelId: 1, content: '', attachmentIds: [mine.id] },
    });
    await ws.next('message.created');
    ws.send({
      type: 'message.send',
      data: { channelId: 1, content: '', attachmentIds: [mine.id] },
    });
    expect((await ws.next('error')).data.code).toBe('attachment_not_found');
    ws.close();
  });

  it('deleting a message removes its file unless another message uses the same image', async () => {
    const { token } = await t.login('admin');
    const ws = await connect(t.app, token);
    const first = await uploadId(token, '#123456');
    const second = await uploadId(token, '#123456'); // same content, same hash
    expect(first.url).toBe(second.url);
    ws.send({
      type: 'message.send',
      data: { channelId: 1, content: '', attachmentIds: [first.id] },
    });
    const m1 = (await ws.next('message.created')).data.message;
    ws.send({
      type: 'message.send',
      data: { channelId: 1, content: '', attachmentIds: [second.id] },
    });
    const m2 = (await ws.next('message.created')).data.message;

    const hash = hashFromUrl(first.url);
    if (!hash) throw new Error('upload has no file');
    const path = new FileStore(t.uploadsDir).pathOf(hash);
    ws.send({ type: 'message.delete', data: { messageId: m1.id } });
    await ws.next('message.deleted');
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(path)).toBe(true);

    ws.send({ type: 'message.delete', data: { messageId: m2.id } });
    await ws.next('message.deleted');
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(path)).toBe(false);
    ws.close();
  });
});
