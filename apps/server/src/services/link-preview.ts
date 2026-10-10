import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { BlockList, isIP, isIPv4, type LookupFunction } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { Embed } from '@letopeiras/shared';

/** Previews per message. */
export const MAX_EMBEDS = 3;
const TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_REDIRECTS = 3;
const USER_AGENT = 'Mozilla/5.0 (compatible; LeTopeirasBot/1.0; link previews)';

// ---------------------------------------------------------------------------
// Which links

// Same shape the client turns into links (lib/markdown.tsx).
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"]+/g;
const URL_TRAILING = /[.,!?;:)\]}'"]+$/;

/**
 * The http(s) links of a message that get a preview: not inside code, not wrapped in <>
 * (how you opt out, like on Discord), each once, at most MAX_EMBEDS.
 */
export function previewUrls(content: string): string[] {
  const text = content.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  const urls: string[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    if (text[match.index - 1] === '<') continue;
    const url = match[0].replace(URL_TRAILING, '');
    if (!urls.includes(url)) urls.push(url);
    if (urls.length === MAX_EMBEDS) break;
  }
  return urls;
}

/** The video id of a YouTube watch, short, embed or youtu.be link. */
export function youtubeId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.slice(1);
  else if (host === 'youtube.com') {
    id =
      url.pathname === '/watch'
        ? url.searchParams.get('v')
        : (/^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname)?.[1] ?? null);
  }
  return id && /^[\w-]{6,20}$/.test(id) ? id : null;
}

// ---------------------------------------------------------------------------
// Where the server may connect (SSRF): never itself, the Oracle network or anything private.

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96], // NAT64
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

/** Whether connecting to `ip` could reach something that isn't the public internet. */
export function isBlockedAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return blocked.check(ip, 'ipv4');
  if (version !== 6) return true;
  // IPv4-mapped (::ffff:10.0.0.1) is the IPv4 address in disguise.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (mapped) return !isIPv4(mapped) || blocked.check(mapped, 'ipv4');
  return blocked.check(ip, 'ipv6');
}

/**
 * DNS lookup for our requests that refuses blocked addresses. It runs as part of the
 * connection, so the address checked is the address used (no DNS-rebinding window).
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true, family: options.family ?? 0 }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      const error = Object.assign(new Error(`Blocked address for ${hostname}`), {
        code: 'EBLOCKED',
      });
      return callback(error, '', 0);
    }
    if (options.all) {
      (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    } else {
      const [first] = list;
      callback(null, first?.address ?? '', first?.family ?? 4);
    }
  });
};

// ---------------------------------------------------------------------------
// Fetching

interface Fetched {
  url: string;
  contentType: string;
  body: Buffer;
}

/** Whether we're willing to request this URL at all (before DNS). */
function assertFetchable(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Not http(s)');
  // Only the standard ports: nothing else on a host is meant for us.
  if (url.port && url.port !== '80' && url.port !== '443') throw new Error('Unusual port');
  if (url.username || url.password) throw new Error('Credentials in URL');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  // An IP literal skips DNS (and so the guarded lookup): check it here.
  if (isIP(host) && isBlockedAddress(host)) throw new Error('Blocked address');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new Error('Local host name');
  }
}

function requestOnce(url: URL, accept: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(
      url,
      {
        lookup: guardedLookup,
        timeout: TIMEOUT_MS,
        headers: {
          'user-agent': USER_AGENT,
          accept,
          'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
          'accept-encoding': 'gzip, deflate, br',
        },
      },
      resolve,
    );
    req.on('timeout', () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
  });
}

/** Reads at most `maxBytes` of the (decompressed) body, then stops. */
function readBody(res: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
  const stream =
    encoding === 'gzip'
      ? res.pipe(createGunzip())
      : encoding === 'br'
        ? res.pipe(createBrotliDecompress())
        : encoding === 'deflate'
          ? res.pipe(createInflate())
          : res;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => finish(), TIMEOUT_MS);
    const finish = () => {
      clearTimeout(timer);
      res.destroy();
      resolve(Buffer.concat(chunks).subarray(0, maxBytes));
    };
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size >= maxBytes) finish();
    });
    stream.on('end', finish);
    stream.on('error', (err) => {
      clearTimeout(timer);
      res.destroy();
      // A truncated compressed stream still gives us its head.
      if (chunks.length) resolve(Buffer.concat(chunks));
      else reject(err);
    });
  });
}

/** GET with every hop checked: protocol, port, address (via DNS), at most MAX_REDIRECTS. */
export async function safeGet(raw: string, accept: string, maxBytes: number): Promise<Fetched> {
  let url = new URL(raw);
  for (let hop = 0; ; hop++) {
    assertFetchable(url);
    const res = await requestOnce(url, accept);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      if (hop === MAX_REDIRECTS) throw new Error('Too many redirects');
      url = new URL(res.headers.location, url);
      continue;
    }
    if (status !== 200) {
      res.resume();
      throw new Error(`HTTP ${status}`);
    }
    const contentType = String(res.headers['content-type'] ?? '').toLowerCase();
    // An image needs no body: knowing it is one is enough.
    if (contentType.startsWith('image/')) {
      res.destroy();
      return { url: url.href, contentType, body: Buffer.alloc(0) };
    }
    return { url: url.href, contentType, body: await readBody(res, maxBytes) };
  }
}

// ---------------------------------------------------------------------------
// Reading pages

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  ordm: 'º',
  ordf: 'ª',
};
// Accented letters (&eacute; &Atilde; &ccedil;…), common on Brazilian pages.
const MARKS: Record<string, string> = {
  acute: '́',
  grave: '̀',
  circ: '̂',
  tilde: '̃',
  uml: '̈',
  cedil: '̧',
};
for (const letter of 'aeiouyncAEIOUYNC') {
  for (const [name, mark] of Object.entries(MARKS)) {
    ENTITIES[`${letter}${name}`] = `${letter}${mark}`.normalize('NFC');
  }
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    // Case matters for letters (&Eacute; is É), not for the rest (&AMP;).
    return ENTITIES[code] ?? ENTITIES[code.toLowerCase()] ?? whole;
  });
}

const clean = (text: string | undefined, max: number): string | null => {
  const value = text && decodeEntities(text).replace(/\s+/g, ' ').trim();
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

/** An absolute http(s) URL for a page's image, or null. */
function absoluteImage(raw: string | undefined, base: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(decodeEntities(raw.trim()), base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * A preview from a page's <head>: Open Graph first, then Twitter cards, then the plain
 * <title> and description. Null when there's nothing worth showing.
 */
export function parsePreview(html: string, pageUrl: string): Embed | null {
  const headEnd = html.search(/<\/head>|<body[\s>]/i);
  const head = headEnd === -1 ? html.slice(0, 200_000) : html.slice(0, headEnd);
  const meta = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = new Map<string, string>();
    for (const [, name, , dq, sq, bare] of tag.matchAll(
      /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g,
    )) {
      if (name) attrs.set(name.toLowerCase(), dq ?? sq ?? bare ?? '');
    }
    const key = (
      attrs.get('property') ??
      attrs.get('name') ??
      attrs.get('itemprop')
    )?.toLowerCase();
    const content = attrs.get('content');
    if (key && content !== undefined && !meta.has(key)) meta.set(key, content);
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];

  const title = clean(meta.get('og:title') ?? meta.get('twitter:title') ?? titleTag, 256);
  const description = clean(
    meta.get('og:description') ?? meta.get('twitter:description') ?? meta.get('description'),
    350,
  );
  const image = absoluteImage(
    meta.get('og:image:secure_url') ??
      meta.get('og:image') ??
      meta.get('og:image:url') ??
      meta.get('twitter:image') ??
      meta.get('twitter:image:src'),
    pageUrl,
  );
  const color = meta.get('theme-color')?.trim() ?? '';
  if (!title && !description && !image) return null;
  return {
    url: pageUrl,
    kind: 'link',
    title,
    description,
    siteName:
      clean(meta.get('og:site_name'), 64) ?? new URL(pageUrl).hostname.replace(/^www\./, ''),
    image,
    color: /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null,
    videoId: null,
  };
}

function decode(body: Buffer, contentType: string): string {
  const charset = /charset=([\w-]+)/.exec(contentType)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

/** The preview of one link, from the network. Null when there's nothing to show. */
export async function fetchPreview(link: string): Promise<Embed | null> {
  const videoId = youtubeId(link);
  if (videoId) {
    // YouTube pages want JavaScript and cookies; oEmbed gives the title straight away.
    const watch = `https://www.youtube.com/watch?v=${videoId}`;
    const { body } = await safeGet(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`,
      'application/json',
      MAX_JSON_BYTES,
    );
    const data = JSON.parse(body.toString('utf8')) as { title?: string; author_name?: string };
    return {
      url: link,
      kind: 'youtube',
      title: clean(data.title, 256),
      description: null,
      siteName: clean(data.author_name, 64) ?? 'YouTube',
      image: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      color: '#ff0000',
      videoId,
    };
  }
  const page = await safeGet(
    link,
    'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    MAX_HTML_BYTES,
  );
  if (page.contentType.startsWith('image/')) {
    return {
      url: link,
      kind: 'image',
      title: null,
      description: null,
      siteName: null,
      image: page.url,
      color: null,
      videoId: null,
    };
  }
  if (!page.contentType.includes('html')) return null;
  const preview = parsePreview(decode(page.body, page.contentType), page.url);
  // Keep the link as posted (the page may have redirected).
  return preview && { ...preview, url: link };
}
