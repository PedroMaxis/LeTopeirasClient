import { isSpotifyTrackUrl, LIMITS, parseYouTubeUrl, type MusicVideo } from '@letopeiras/shared';
import { AppError, badRequest, notFound } from '../lib/errors';

const TIMEOUT_MS = 5_000;
/** Search and video answers stay a day. */
const CACHE_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
/** Searches per day. The YouTube quota is 10,000 units and each search costs 100. */
const DAILY_SEARCHES = 95;
const RESULTS = 10;

/** GETs a URL and returns its JSON. Tests replace it so nothing touches the network. */
export type JsonFetcher = (url: string) => Promise<unknown>;

/** The only places the server talks to for music. */
const ALLOWED = [
  { host: 'www.googleapis.com', path: '/youtube/v3/' },
  { host: 'www.youtube.com', path: '/oembed' },
  { host: 'open.spotify.com', path: '/oembed' },
];

/**
 * The default fetcher: fixed hosts only, a timeout, and errors that never carry the URL
 * (it holds the API key).
 */
export const fetchJson: JsonFetcher = async (raw) => {
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' ||
    !ALLOWED.some((a) => a.host === url.hostname && url.pathname.startsWith(a.path))
  ) {
    throw new Error('Host not allowed');
  }
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'application/json' },
    redirect: 'error',
  });
  if (!res.ok) throw new HttpStatusError(res.status);
  return res.json();
};

export class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

const unavailable = () =>
  new AppError(502, 'music_unavailable', 'Não deu para falar com o YouTube agora');

/** "PT3M25S" → milliseconds; 0 (live streams are "P0D") → null. */
export function parseIsoDuration(iso: string): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m) return null;
  const [, d, h, min, s] = m.map((v) => Number(v ?? 0));
  const ms = (((d ?? 0) * 24 + (h ?? 0)) * 60 + (min ?? 0)) * 60_000 + (s ?? 0) * 1000;
  return ms > 0 ? ms : null;
}

/** Lowercase, single spaces: "  Daft  Punk " and "daft punk" share a cache entry. */
export const normalizeQuery = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ');

/** Midnight in Pacific time is when the YouTube quota resets. */
const quotaDay = (now: number) =>
  new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

interface Cached<T> {
  at: number;
  value: T;
}

class TtlCache<T> {
  private readonly map = new Map<string, Cached<T>>();
  constructor(private readonly now: () => number) {}

  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at > CACHE_MS) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T): void {
    this.map.delete(key);
    this.map.set(key, { at: this.now(), value });
    // Maps keep insertion order, so the first key is the oldest.
    if (this.map.size > CACHE_MAX) this.map.delete(this.map.keys().next().value as string);
  }
}

export interface YouTubeDeps {
  apiKey: string | undefined;
  fetchJson: JsonFetcher;
  now?: () => number;
}

/**
 * Finds songs and describes videos for the music queue. With a key it uses the YouTube
 * Data API (search, duration, "can be embedded"); without one only links work, through
 * oEmbed, and durations are unknown.
 */
export class YouTubeService {
  private readonly now: () => number;
  private readonly videos: TtlCache<MusicVideo>;
  private readonly searches: TtlCache<MusicVideo[]>;
  private day = '';
  private used = 0;

  constructor(private readonly deps: YouTubeDeps) {
    this.now = deps.now ?? Date.now;
    this.videos = new TtlCache(this.now);
    this.searches = new TtlCache(this.now);
  }

  get canSearch(): boolean {
    return this.deps.apiKey !== undefined;
  }

  /** One video, for the queue. Throws if it doesn't exist or can't play outside YouTube. */
  async video(videoId: string): Promise<MusicVideo> {
    const cached = this.videos.get(videoId);
    if (cached) return cached;
    const video = this.deps.apiKey ? await this.apiVideo(videoId) : await this.oembedVideo(videoId);
    this.videos.set(videoId, video);
    return video;
  }

  /** Text, a YouTube link or a Spotify track link → up to 10 videos that can be embedded. */
  async search(input: string): Promise<MusicVideo[]> {
    const q = input.trim();
    if (!q || q.length > LIMITS.musicSearchMax) throw badRequest('Busca inválida');

    const linked = parseYouTubeUrl(q);
    if (linked) return [await this.video(linked)];

    let text = q;
    if (isSpotifyTrackUrl(q)) {
      if (!this.deps.apiKey) throw this.disabled();
      text = await this.spotifyTitle(q);
    }
    return this.textSearch(text);
  }

  private disabled() {
    return new AppError(
      503,
      'music_search_disabled',
      'A busca de músicas não está ligada, cole o link do YouTube',
    );
  }

  private async textSearch(text: string): Promise<MusicVideo[]> {
    const { apiKey } = this.deps;
    if (!apiKey) throw this.disabled();
    const key = normalizeQuery(text);
    const cached = this.searches.get(key);
    if (cached) return cached;

    const today = quotaDay(this.now());
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
    if (this.used >= DAILY_SEARCHES) {
      throw new AppError(429, 'music_quota', 'As buscas de hoje acabaram, cole o link do YouTube');
    }
    this.used++;

    const found = (await this.call('search', {
      part: 'snippet',
      type: 'video',
      videoEmbeddable: 'true',
      regionCode: 'BR',
      relevanceLanguage: 'pt',
      maxResults: String(RESULTS),
      q: text,
      key: apiKey,
    })) as { items?: Array<{ id?: { videoId?: string } }> };
    const ids = (found.items ?? [])
      .map((item) => item.id?.videoId)
      .filter((id): id is string => typeof id === 'string');
    const results = ids.length ? await this.apiVideos(ids) : [];
    this.searches.set(key, results);
    return results;
  }

  private async spotifyTitle(link: string): Promise<string> {
    try {
      const data = (await this.deps.fetchJson(
        `https://open.spotify.com/oembed?url=${encodeURIComponent(link)}`,
      )) as { title?: string };
      if (data.title) return data.title;
    } catch {
      // Falls through to the same message as an empty title.
    }
    throw notFound('Não achei essa música do Spotify');
  }

  private async apiVideo(videoId: string): Promise<MusicVideo> {
    const [video] = await this.apiVideos([videoId], true);
    if (!video) throw notFound('Vídeo não encontrado');
    return video;
  }

  /**
   * `videos.list` for up to 50 ids (1 unit). Videos that can't be embedded are dropped, or
   * reported when `strict` (the one the person asked for by link).
   */
  private async apiVideos(ids: string[], strict = false): Promise<MusicVideo[]> {
    const data = (await this.call('videos', {
      part: 'snippet,contentDetails,status',
      id: ids.join(','),
      key: this.deps.apiKey ?? '',
    })) as {
      items?: Array<{
        id: string;
        snippet?: {
          title?: string;
          channelTitle?: string;
          thumbnails?: Record<string, { url?: string } | undefined>;
        };
        contentDetails?: { duration?: string };
        status?: { embeddable?: boolean };
      }>;
    };
    const out: MusicVideo[] = [];
    for (const item of data.items ?? []) {
      if (item.status?.embeddable === false) {
        if (strict) throw notEmbeddable();
        continue;
      }
      const thumbs = item.snippet?.thumbnails;
      const video: MusicVideo = {
        videoId: item.id,
        title: item.snippet?.title ?? item.id,
        author: item.snippet?.channelTitle ?? '',
        durationMs: parseIsoDuration(item.contentDetails?.duration ?? ''),
        thumbnailUrl: thumbs?.medium?.url ?? thumbs?.default?.url ?? thumbnailOf(item.id),
      };
      this.videos.set(video.videoId, video);
      out.push(video);
    }
    // Keep the order YouTube ranked them in.
    return ids.flatMap((id) => out.filter((v) => v.videoId === id));
  }

  private async oembedVideo(videoId: string): Promise<MusicVideo> {
    try {
      const data = (await this.deps.fetchJson(
        `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(
          `https://www.youtube.com/watch?v=${videoId}`,
        )}`,
      )) as { title?: string; author_name?: string; thumbnail_url?: string };
      return {
        videoId,
        title: data.title ?? videoId,
        author: data.author_name ?? '',
        durationMs: null,
        thumbnailUrl: data.thumbnail_url ?? thumbnailOf(videoId),
      };
    } catch (err) {
      // oEmbed answers 401 for videos that can't be embedded and 404 for missing ones.
      if (err instanceof HttpStatusError && err.status === 401) throw notEmbeddable();
      if (err instanceof HttpStatusError && (err.status === 404 || err.status === 400)) {
        throw notFound('Vídeo não encontrado');
      }
      throw unavailable();
    }
  }

  private async call(endpoint: string, params: Record<string, string>): Promise<unknown> {
    const url = `https://www.googleapis.com/youtube/v3/${endpoint}?${new URLSearchParams(params)}`;
    try {
      return await this.deps.fetchJson(url);
    } catch {
      // Never log or forward the error: its text could carry the URL, and the key with it.
      throw unavailable();
    }
  }
}

const thumbnailOf = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

const notEmbeddable = () =>
  new AppError(422, 'not_embeddable', 'Esse vídeo não pode tocar fora do YouTube');
