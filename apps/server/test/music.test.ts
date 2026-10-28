import {
  LIMITS,
  musicSearchResponseSchema,
  type MusicTrack,
  type MusicVideo,
} from '@letopeiras/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_ROOM_GRACE_MS, MusicStore } from '../src/services/music';
import { parseIsoDuration, type JsonFetcher } from '../src/services/youtube';
import { bearer, connect, createTestApp } from './helpers';

const must = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error('Expected a value');
  return value;
};
const playingId = (store: MusicStore) => must(store.get(2).current).track.id;

const video = (n: number, durationMs: number | null = 200_000): MusicVideo => ({
  videoId: `video${String(n).padStart(6, '0')}`,
  title: `Song ${n}`,
  author: 'Band',
  durationMs,
  thumbnailUrl: 'https://i.ytimg.com/vi/x/mqdefault.jpg',
});

describe('MusicStore', () => {
  const changes: number[] = [];
  const failures: MusicTrack[] = [];
  let store: MusicStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    changes.length = 0;
    failures.length = 0;
    store = new MusicStore({
      onChange: (id) => changes.push(id),
      onFailed: (_id, track) => failures.push(track),
    });
  });
  afterEach(() => {
    store.close();
    vi.useRealTimers();
  });

  it('starts the first song and queues the rest', () => {
    store.add(2, video(1), 7);
    store.add(2, video(2), 8);
    const state = store.get(2);
    expect(state.current).toMatchObject({ paused: false, positionMs: 0, at: 1_000_000 });
    expect(state.current?.track).toMatchObject({ title: 'Song 1', addedBy: 7 });
    expect(state.queue.map((t) => t.title)).toEqual(['Song 2']);
    expect(changes).toEqual([2, 2]);
  });

  it('accepts the same video twice with different track ids', () => {
    store.add(2, video(1), 7);
    store.add(2, video(1), 7);
    expect(store.get(2).current?.track.id).not.toBe(store.get(2).queue[0]?.id);
  });

  it('limits the queue', () => {
    store.add(2, video(0), 1);
    for (let i = 1; i <= LIMITS.musicQueue; i++) store.add(2, video(i), 1);
    expect(() => store.add(2, video(99), 1)).toThrow(/cheia/);
  });

  it('keeps each room apart', () => {
    store.add(2, video(1), 1);
    expect(store.get(3).current).toBeNull();
    expect(store.all().map((s) => s.channelId)).toEqual([2]);
  });

  it('pauses and resumes keeping the position', () => {
    store.add(2, video(1), 1);
    vi.advanceTimersByTime(30_000);
    store.pause(2);
    expect(store.get(2).current).toMatchObject({ paused: true, positionMs: 30_000 });
    vi.advanceTimersByTime(60_000);
    store.play(2);
    const current = must(store.get(2).current);
    expect(current).toMatchObject({ paused: false, positionMs: 30_000 });
    expect(store.positionOf(current, Date.now() + 5_000)).toBe(35_000);
  });

  it('seeks, clamping to just before the end', () => {
    store.add(2, video(1, 100_000), 1);
    store.seek(2, 40_000);
    expect(store.get(2).current?.positionMs).toBe(40_000);
    store.seek(2, 500_000);
    expect(store.get(2).current?.positionMs).toBe(99_999);
  });

  it('moves on by itself when the duration runs out', () => {
    store.add(2, video(1, 100_000), 1);
    store.add(2, video(2, 100_000), 1);
    vi.advanceTimersByTime(99_999);
    expect(store.get(2).current?.track.title).toBe('Song 1');
    vi.advanceTimersByTime(1);
    expect(store.get(2).current?.track.title).toBe('Song 2');
    expect(store.get(2).queue).toEqual([]);
    vi.advanceTimersByTime(100_000);
    expect(store.get(2).current).toBeNull();
  });

  it('does not run the clock while paused, and resumes from where it was', () => {
    store.add(2, video(1, 100_000), 1);
    store.add(2, video(2), 1);
    vi.advanceTimersByTime(60_000);
    store.pause(2);
    vi.advanceTimersByTime(500_000);
    expect(store.get(2).current?.track.title).toBe('Song 1');
    store.play(2);
    vi.advanceTimersByTime(40_000);
    expect(store.get(2).current?.track.title).toBe('Song 2');
  });

  it('a seek reschedules the end', () => {
    store.add(2, video(1, 100_000), 1);
    store.add(2, video(2), 1);
    store.seek(2, 90_000);
    vi.advanceTimersByTime(10_000);
    expect(store.get(2).current?.track.title).toBe('Song 2');
  });

  it('skips, and removes songs from the queue or the one playing', () => {
    store.add(2, video(1), 1);
    store.add(2, video(2), 1);
    store.add(2, video(3), 1);
    store.remove(2, must(store.get(2).queue[0]).id);
    expect(store.get(2).queue.map((t) => t.title)).toEqual(['Song 3']);
    store.remove(2, playingId(store));
    expect(store.get(2).current?.track.title).toBe('Song 3');
    store.skip(2);
    expect(store.get(2).current).toBeNull();
  });

  it('clears the queue but not what is playing', () => {
    store.add(2, video(1), 1);
    store.add(2, video(2), 1);
    store.clear(2);
    expect(store.get(2).queue).toEqual([]);
    expect(store.get(2).current?.track.title).toBe('Song 1');
  });

  it('takes ended from a player only near the end', () => {
    store.add(2, video(1, 100_000), 1);
    store.add(2, video(2), 1);
    const id = playingId(store);
    store.ended(2, id);
    expect(store.get(2).current?.track.id).toBe(id);
    store.seek(2, 97_000);
    store.ended(2, id);
    expect(store.get(2).current?.track.title).toBe('Song 2');
  });

  it('ignores ended for a song that is no longer current', () => {
    store.add(2, video(1, null), 1);
    store.add(2, video(2, null), 1);
    const first = playingId(store);
    store.ended(2, first);
    expect(store.get(2).current?.track.title).toBe('Song 2');
    store.ended(2, first);
    expect(store.get(2).current?.track.title).toBe('Song 2');
  });

  it('relies on ended when the duration is unknown', () => {
    store.add(2, video(1, null), 1);
    vi.advanceTimersByTime(3_600_000);
    expect(store.get(2).current?.track.title).toBe('Song 1');
    store.ended(2, playingId(store));
    expect(store.get(2).current).toBeNull();
  });

  it('skips a song that failed and says which', () => {
    store.add(2, video(1), 1);
    store.add(2, video(2), 1);
    store.failed(2, playingId(store));
    expect(failures.map((t) => t.title)).toEqual(['Song 1']);
    expect(store.get(2).current?.track.title).toBe('Song 2');
  });

  it('drops the room a minute after the last person left', () => {
    store.add(2, video(1), 1);
    store.roomChanged(2, 0);
    vi.advanceTimersByTime(EMPTY_ROOM_GRACE_MS - 1);
    expect(store.get(2).current).not.toBeNull();
    changes.length = 0;
    vi.advanceTimersByTime(1);
    expect(store.get(2).current).toBeNull();
    expect(changes).toEqual([2]);
  });

  it('keeps the room when someone comes back in time', () => {
    store.add(2, video(1), 1);
    store.roomChanged(2, 0);
    vi.advanceTimersByTime(30_000);
    store.roomChanged(2, 1);
    vi.advanceTimersByTime(EMPTY_ROOM_GRACE_MS * 2);
    expect(store.get(2).current).not.toBeNull();
  });
});

describe('parseIsoDuration', () => {
  it('reads YouTube durations', () => {
    expect(parseIsoDuration('PT3M25S')).toBe(205_000);
    expect(parseIsoDuration('PT1H2M')).toBe(3_720_000);
    expect(parseIsoDuration('PT45S')).toBe(45_000);
    expect(parseIsoDuration('P1DT1H')).toBe(90_000_000);
  });

  it('gives null for live streams and garbage', () => {
    expect(parseIsoDuration('P0D')).toBeNull();
    expect(parseIsoDuration('nope')).toBeNull();
  });
});

/** Answers like the YouTube Data API and the oEmbed endpoints, counting calls. */
function fakeYouTube(options: { embeddable?: boolean; missing?: boolean } = {}) {
  const calls: string[] = [];
  const fetchJson: JsonFetcher = (raw) => {
    calls.push(raw);
    const url = new URL(raw);
    if (url.pathname.endsWith('/search')) {
      return Promise.resolve({
        items: [{ id: { videoId: 'video000001' } }, { id: { videoId: 'video000002' } }],
      });
    }
    if (url.pathname.endsWith('/videos')) {
      if (options.missing) return Promise.resolve({ items: [] });
      const ids = (url.searchParams.get('id') ?? '').split(',');
      return Promise.resolve({
        items: ids.map((id) => ({
          id,
          snippet: {
            title: `Title ${id}`,
            channelTitle: 'Channel',
            thumbnails: { medium: { url: `https://i.ytimg.com/vi/${id}/mq.jpg` } },
          },
          contentDetails: { duration: 'PT3M' },
          status: { embeddable: options.embeddable ?? true },
        })),
      });
    }
    if (url.hostname === 'open.spotify.com') {
      return Promise.resolve({ title: 'Some Song - Some Band' });
    }
    return Promise.resolve({
      title: 'oEmbed title',
      author_name: 'oEmbed author',
      thumbnail_url: 'https://i.ytimg.com/x.jpg',
    });
  };
  return { fetchJson, calls };
}

describe('GET /music/search', () => {
  const search = (
    app: Awaited<ReturnType<typeof createTestApp>>['app'],
    token: string,
    q: string,
  ) =>
    app.inject({
      method: 'GET',
      url: `/music/search?q=${encodeURIComponent(q)}`,
      headers: bearer(token),
    });

  it('needs a login', async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/music/search?q=x' });
    expect(res.statusCode).toBe(401);
    await t.close();
  });

  it('searches text with a key and caches the answer', async () => {
    const yt = fakeYouTube();
    const t = await createTestApp({ fetchJson: yt.fetchJson, youtubeApiKey: 'KEY' });
    const { token } = await t.login('admin');
    const res = await search(t.app, token, 'Daft Punk');
    expect(res.statusCode).toBe(200);
    const { results } = musicSearchResponseSchema.parse(res.json());
    expect(results.map((r) => r.videoId)).toEqual(['video000001', 'video000002']);
    expect(results[0]).toMatchObject({ title: 'Title video000001', durationMs: 180_000 });
    const searchUrl = new URL(must(yt.calls[0]));
    expect(searchUrl.searchParams.get('videoEmbeddable')).toBe('true');
    expect(searchUrl.searchParams.get('regionCode')).toBe('BR');
    // 1 search + 1 videos.list, and the same query (any spacing or case) costs nothing more.
    expect(yt.calls).toHaveLength(2);
    await search(t.app, token, '  daft   PUNK ');
    expect(yt.calls).toHaveLength(2);
    await t.close();
  });

  it('is off without a key, but links still work through oEmbed', async () => {
    const yt = fakeYouTube();
    const t = await createTestApp({ fetchJson: yt.fetchJson });
    const { token } = await t.login('admin');
    const text = await search(t.app, token, 'daft punk');
    expect(text.statusCode).toBe(503);
    expect(text.json().error.code).toBe('music_search_disabled');

    const link = await search(t.app, token, 'https://youtu.be/dQw4w9WgXcQ?t=3');
    expect(link.statusCode).toBe(200);
    expect(link.json().results).toEqual([
      {
        videoId: 'dQw4w9WgXcQ',
        title: 'oEmbed title',
        author: 'oEmbed author',
        durationMs: null,
        thumbnailUrl: 'https://i.ytimg.com/x.jpg',
      },
    ]);
    const spotify = await search(t.app, token, 'https://open.spotify.com/track/abc123');
    expect(spotify.statusCode).toBe(503);
    await t.close();
  });

  it('a YouTube link with a key costs no search', async () => {
    const yt = fakeYouTube();
    const t = await createTestApp({ fetchJson: yt.fetchJson, youtubeApiKey: 'KEY' });
    const { token } = await t.login('admin');
    const res = await search(t.app, token, 'https://music.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(res.json().results).toHaveLength(1);
    expect(yt.calls).toHaveLength(1);
    expect(yt.calls[0]).toContain('/videos?');
    await t.close();
  });

  it('finds a Spotify track by its title on YouTube', async () => {
    const yt = fakeYouTube();
    const t = await createTestApp({ fetchJson: yt.fetchJson, youtubeApiKey: 'KEY' });
    const { token } = await t.login('admin');
    const res = await search(t.app, token, 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC');
    expect(res.statusCode).toBe(200);
    expect(new URL(must(yt.calls[1])).searchParams.get('q')).toBe('Some Song - Some Band');
    await t.close();
  });

  it('refuses videos that cannot be embedded', async () => {
    const t = await createTestApp({
      fetchJson: fakeYouTube({ embeddable: false }).fetchJson,
      youtubeApiKey: 'KEY',
    });
    const { token } = await t.login('admin');
    const res = await search(t.app, token, 'https://youtu.be/dQw4w9WgXcQ');
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('not_embeddable');
    await t.close();
  });

  it('stops text searches at the daily budget, and never leaks the key on failures', async () => {
    const yt = fakeYouTube();
    const t = await createTestApp({ fetchJson: yt.fetchJson, youtubeApiKey: 'SECRET-KEY' });
    const { token } = await t.login('admin');
    // The per-minute limit is 10, so the day's 95 searches span several "minutes".
    vi.useFakeTimers({ toFake: ['Date'] });
    let last = 200;
    for (let i = 0; i < 96; i++) {
      if (i % 10 === 0) vi.setSystemTime(Date.now() + 61_000);
      last = (await search(t.app, token, `query ${i}`)).statusCode;
    }
    vi.useRealTimers();
    expect(last).toBe(429);
    await t.close();
  });

  it('hides provider failures behind a generic error', async () => {
    const t = await createTestApp({
      fetchJson: () => Promise.reject(new Error('boom https://x?key=SECRET-KEY')),
      youtubeApiKey: 'SECRET-KEY',
    });
    const { token } = await t.login('admin');
    const res = await search(t.app, token, 'anything');
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('SECRET-KEY');
    await t.close();
  });

  it('limits searches per person', async () => {
    const t = await createTestApp({ fetchJson: fakeYouTube().fetchJson, youtubeApiKey: 'KEY' });
    const { token } = await t.login('admin');
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await search(t.app, token, `q${i}`)).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
    await t.close();
  });
});

describe('music over the WebSocket', () => {
  it('only works for people in the voice room', async () => {
    const t = await createTestApp({ fetchJson: fakeYouTube().fetchJson, youtubeApiKey: 'KEY' });
    const admin = await t.login('admin');
    const ws = await connect(t.app, admin.token);
    ws.send({ type: 'music.add', data: { channelId: 2, videoId: 'video000001' } });
    const err = await ws.next('error');
    expect(err.data).toMatchObject({ code: 'not_in_voice', ref: 'music.add' });
    ws.send({ type: 'music.skip', data: { channelId: 2 } });
    expect((await ws.next('error')).data.code).toBe('not_in_voice');
    ws.send({ type: 'music.add', data: { channelId: 1, videoId: 'video000001' } });
    expect((await ws.next('error')).data.code).toBe('not_voice_channel');
    ws.close();
    await t.close();
  });

  it('queues, controls and shares the state with the room and the people watching the channel', async () => {
    const t = await createTestApp({ fetchJson: fakeYouTube().fetchJson, youtubeApiKey: 'KEY' });
    const admin = await t.login('admin');
    const maria = await t.register('maria');
    t.app.ctx.voice.join(2, admin.user.id);
    t.app.ctx.voice.join(2, maria.user.id);
    const a = await connect(t.app, admin.token);
    const m = await connect(t.app, maria.token);

    a.send({ type: 'music.add', data: { channelId: 2, videoId: 'video000001' } });
    const added = (await m.next('music.state')).data;
    expect(added.current?.track).toMatchObject({ videoId: 'video000001', addedBy: admin.user.id });
    expect(added.serverNow).toBeGreaterThan(0);

    m.send({ type: 'music.add', data: { channelId: 2, videoId: 'video000002' } });
    expect((await a.next('music.state')).data.queue).toHaveLength(0); // the first one's own state
    expect((await a.next('music.state')).data.queue).toHaveLength(1);

    a.send({ type: 'music.pause', data: { channelId: 2 } });
    await m.next('music.state');
    const paused = (await m.next('music.state')).data;
    expect(paused.current?.paused).toBe(true);

    a.close();
    m.close();
    await t.close();
  });

  it('puts the music in ready for new connections', async () => {
    const t = await createTestApp({ fetchJson: fakeYouTube().fetchJson, youtubeApiKey: 'KEY' });
    const admin = await t.login('admin');
    t.app.ctx.voice.join(2, admin.user.id);
    t.app.ctx.music.add(2, video(1), admin.user.id);
    const ws = await connect(t.app, admin.token);
    expect(ws.ready?.music).toHaveLength(1);
    expect(ws.ready?.music[0]?.current?.track.title).toBe('Song 1');
    ws.close();
    await t.close();
  });

  it('tells the room when a song could not be played', async () => {
    const t = await createTestApp({ fetchJson: fakeYouTube().fetchJson, youtubeApiKey: 'KEY' });
    const admin = await t.login('admin');
    t.app.ctx.voice.join(2, admin.user.id);
    t.app.ctx.music.add(2, video(1), admin.user.id);
    const ws = await connect(t.app, admin.token);
    const id = playingId(t.app.ctx.music);
    ws.send({ type: 'music.failed', data: { channelId: 2, trackId: id } });
    expect((await ws.next('music.failed')).data).toEqual({ channelId: 2, title: 'Song 1' });
    expect((await ws.next('music.state')).data.current).toBeNull();
    ws.close();
    await t.close();
  });

  it("does not show a private room's music to people without access", async () => {
    const t = await createTestApp({ fetchJson: fakeYouTube().fetchJson, youtubeApiKey: 'KEY' });
    const admin = await t.login('admin');
    const maria = await t.register('maria');
    const role = await t.app.inject({
      method: 'POST',
      url: '/roles',
      headers: bearer(admin.token),
      payload: { name: 'VIP', color: '#F0782A' },
    });
    const created = await t.app.inject({
      method: 'POST',
      url: '/channels',
      headers: bearer(admin.token),
      payload: { name: 'vip', type: 'voice', isPrivate: true, roleIds: [role.json().id] },
    });
    expect(created.statusCode).toBe(201);
    const vip = created.json().id as number;
    const ws = await connect(t.app, maria.token);
    t.app.ctx.voice.join(vip, admin.user.id);
    t.app.ctx.music.add(vip, video(1), admin.user.id);
    expect(await ws.receives('music.state')).toBe(false);
    expect(ws.ready?.music).toEqual([]);
    ws.send({ type: 'music.skip', data: { channelId: vip } });
    expect((await ws.next('error')).data.code).toBe('forbidden');
    ws.close();
    await t.close();
  });
});
