import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { Embed } from '@letopeiras/shared';
import {
  decodeEntities,
  fetchPreview,
  isBlockedAddress,
  parsePreview,
  previewUrls,
  safeGet,
  youtubeId,
} from '../src/services/link-preview';
import { connect, createTestApp, type TestSocket } from './helpers';

describe('previewUrls', () => {
  it('takes up to three links, once each, trimming punctuation', () => {
    expect(
      previewUrls(
        'olha https://a.com/x, e https://b.com/y. https://a.com/x https://c.com https://d.com',
      ),
    ).toEqual(['https://a.com/x', 'https://b.com/y', 'https://c.com']);
  });

  it('skips links in code and links wrapped in <>', () => {
    expect(
      previewUrls('`https://a.com` ```\nhttps://b.com\n``` <https://c.com> https://d.com'),
    ).toEqual(['https://d.com']);
  });
});

describe('youtubeId', () => {
  it('reads the usual link shapes', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://youtube.com/shorts/abcDEF12345')).toBe('abcDEF12345');
    expect(youtubeId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://youtube.com/@canal')).toBeNull();
    expect(youtubeId('https://notyoutube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });
});

describe('isBlockedAddress', () => {
  it('blocks loopback, private, link-local (cloud metadata) and mapped addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.5',
      '192.168.0.10',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      '::',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      'not-an-ip',
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '142.250.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });
});

describe('parsePreview', () => {
  it('prefers Open Graph, resolves the image and decodes entities', () => {
    const html = `<html><head>
      <title>Plain title</title>
      <meta property="og:title" content="Caf&eacute; &amp; P&atilde;o &#8212; ok">
      <meta name="description" content="Fallback">
      <meta property='og:description' content='Descrição'>
      <meta property="og:image" content="/img/capa.png">
      <meta property="og:site_name" content="Padaria">
      <meta name="theme-color" content="#FF8800">
    </head><body><meta property="og:title" content="ignored"></body></html>`;
    expect(parsePreview(html, 'https://padaria.com/post/1')).toEqual<Embed>({
      url: 'https://padaria.com/post/1',
      kind: 'link',
      title: 'Café & Pão — ok',
      description: 'Descrição',
      siteName: 'Padaria',
      image: 'https://padaria.com/img/capa.png',
      color: '#ff8800',
      videoId: null,
    });
  });

  it('falls back to <title> and the host name, and ignores non-http images', () => {
    const preview = parsePreview(
      '<head><title> Só o título </title><meta property="og:image" content="javascript:alert(1)"></head>',
      'https://www.exemplo.com.br/',
    );
    expect(preview).toMatchObject({
      title: 'Só o título',
      siteName: 'exemplo.com.br',
      image: null,
    });
  });

  it('returns null for pages with nothing to show', () => {
    expect(parsePreview('<html><head></head><body>oi</body></html>', 'https://x.com')).toBeNull();
  });

  it('decodes numeric and named entities', () => {
    expect(decodeEntities('&lt;b&gt; &#65;&#x42; &quot;x&quot; &bogus;')).toBe(
      '<b> AB "x" &bogus;',
    );
  });
});

describe('safeGet', () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  it('refuses loopback, IP literals, odd ports and redirects into the private network', async () => {
    server = createServer((_req, res) => {
      res.writeHead(302, { location: 'http://127.0.0.1/' }).end();
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    await expect(safeGet('http://127.0.0.1/', 'text/html', 1000)).rejects.toThrow();
    await expect(safeGet('http://localhost/', 'text/html', 1000)).rejects.toThrow();
    await expect(safeGet(`http://127.0.0.1:${port}/`, 'text/html', 1000)).rejects.toThrow();
    await expect(safeGet('http://[::1]/', 'text/html', 1000)).rejects.toThrow();
    await expect(
      safeGet('http://169.254.169.254/latest/meta-data', 'text/html', 1000),
    ).rejects.toThrow();
    await expect(safeGet('file:///etc/passwd', 'text/html', 1000)).rejects.toThrow();
    // A public-looking name that resolves to loopback is refused at connect time.
    await expect(safeGet('http://localtest.me/', 'text/html', 1000)).rejects.toThrow();
  });

  it('gives no preview for blocked links', async () => {
    await expect(fetchPreview('http://127.0.0.1/admin')).rejects.toThrow();
  });
});

describe('link previews on messages', () => {
  let t: Awaited<ReturnType<typeof createTestApp>> | undefined;
  const sockets: TestSocket[] = [];
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await t?.close();
  });

  const preview = (url: string): Embed => ({
    url,
    kind: 'link',
    title: `Título de ${url}`,
    description: null,
    siteName: 'site',
    image: null,
    color: null,
    videoId: null,
  });

  it('adds previews after sending, caches them, and follows edits', async () => {
    const fetched: string[] = [];
    t = await createTestApp({
      fetchPreview: (url) => {
        fetched.push(url);
        return Promise.resolve(url.includes('nada') ? null : preview(url));
      },
    });
    const maria = await t.register('maria');
    const ws = await connect(t.app, maria.token);
    sockets.push(ws);

    ws.send({
      type: 'message.send',
      data: { channelId: 1, content: 'vê https://a.com e https://nada.com' },
    });
    const sent = (await ws.next('message.created')).data.message;
    expect(sent.embeds).toEqual([]);
    const { message } = (await ws.next('message.updated')).data;
    expect(message.embeds).toEqual([preview('https://a.com')]);

    // Posting the same link again uses the cache.
    ws.send({ type: 'message.send', data: { channelId: 1, content: 'de novo https://a.com' } });
    await ws.next('message.created');
    await ws.next('message.updated');
    expect(fetched).toEqual(['https://a.com', 'https://nada.com']);

    // Editing the links away removes the previews.
    ws.send({ type: 'message.edit', data: { messageId: sent.id, content: 'sem links' } });
    await ws.next('message.updated');
    expect((await ws.next('message.updated')).data.message.embeds).toEqual([]);
  });
});
