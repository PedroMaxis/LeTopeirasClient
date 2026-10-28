import type { MusicCurrent, MusicTrack } from '@letopeiras/shared';
import { describe, expect, it } from 'vitest';
import { expectedPositionMs, planSync, type PlayerSnapshot } from './music-sync';
import { commandFrame, listeningFrame, parsePlayerMessage } from './youtube-protocol';

const track: MusicTrack = {
  id: 1,
  videoId: 'abcdefghijk',
  title: 'Song',
  author: 'Band',
  durationMs: 200_000,
  thumbnailUrl: '',
  addedBy: 1,
};
const current = (patch: Partial<MusicCurrent> = {}): MusicCurrent => ({
  track,
  paused: false,
  positionMs: 10_000,
  at: 1_000_000,
  ...patch,
});

describe('expectedPositionMs', () => {
  it('advances with the server clock while playing', () => {
    // Our clock is 500 ms behind the server's.
    expect(expectedPositionMs(current(), 500, 1_002_000 - 500)).toBe(12_000);
  });

  it('stays put while paused', () => {
    expect(expectedPositionMs(current({ paused: true }), 0, 9_999_999)).toBe(10_000);
  });

  it('never goes back in time', () => {
    expect(expectedPositionMs(current(), 0, 900_000)).toBe(10_000);
  });
});

const desired = (patch: Partial<Parameters<typeof planSync>[0]> = {}) => ({
  videoId: 'abcdefghijk',
  paused: false,
  expectedMs: 30_000,
  durationMs: 200_000 as number | null,
  ...patch,
});
const player = (patch: Partial<PlayerSnapshot> = {}): PlayerSnapshot => ({
  videoId: 'abcdefghijk',
  state: 1,
  timeMs: 30_000,
  ...patch,
});

describe('planSync', () => {
  it('loads the right video at the right place', () => {
    expect(planSync(desired(), player({ videoId: 'other' }))).toEqual([
      { type: 'load', videoId: 'abcdefghijk', startMs: 30_000 },
    ]);
    expect(planSync(desired(), player({ videoId: null }))).toHaveLength(1);
  });

  it('does nothing when in sync', () => {
    expect(planSync(desired(), player({ timeMs: 31_000 }))).toEqual([]);
  });

  it('seeks when too far off', () => {
    expect(planSync(desired(), player({ timeMs: 27_000 }))).toEqual([{ type: 'seek', ms: 30_000 }]);
    expect(planSync(desired(), player({ timeMs: 40_000 }))).toEqual([{ type: 'seek', ms: 30_000 }]);
  });

  it('does not seek while buffering', () => {
    expect(planSync(desired(), player({ state: 3, timeMs: 0 }))).toEqual([]);
  });

  it('plays a player that is paused or has not started', () => {
    expect(planSync(desired(), player({ state: 2 }))).toEqual([{ type: 'play' }]);
    expect(planSync(desired(), player({ state: 5 }))).toEqual([{ type: 'play' }]);
    expect(planSync(desired(), player({ state: -1 }))).toEqual([{ type: 'play' }]);
  });

  it('pauses a playing player when the room is paused, and parks it on the position', () => {
    expect(planSync(desired({ paused: true }), player({ timeMs: 30_100 }))).toEqual([
      { type: 'pause' },
    ]);
    expect(planSync(desired({ paused: true }), player({ state: 2, timeMs: 20_000 }))).toEqual([
      { type: 'seek', ms: 30_000 },
    ]);
  });

  it('leaves a player that ended near the end alone until the server moves on', () => {
    const near = desired({ expectedMs: 199_000 });
    expect(planSync(near, player({ state: 0, timeMs: 199_800 }))).toEqual([]);
    // Ended early (a short ad took its place, say): bring it back.
    expect(planSync(desired(), player({ state: 0, timeMs: 5_000 }))).toEqual([
      { type: 'seek', ms: 30_000 },
      { type: 'play' },
    ]);
  });
});

describe('parsePlayerMessage', () => {
  it('reads state, error and ready events', () => {
    expect(parsePlayerMessage(JSON.stringify({ event: 'onReady', info: null }))).toEqual({
      type: 'ready',
    });
    expect(parsePlayerMessage(JSON.stringify({ event: 'onStateChange', info: 0 }))).toEqual({
      type: 'state',
      state: 0,
    });
    expect(parsePlayerMessage(JSON.stringify({ event: 'onError', info: 153 }))).toEqual({
      type: 'error',
      code: 153,
    });
  });

  it('reads the info the player reports as it changes', () => {
    const message = JSON.stringify({
      event: 'infoDelivery',
      info: {
        playerState: 1,
        currentTime: 12.3456,
        duration: 200,
        videoData: { video_id: 'abcdefghijk' },
      },
    });
    expect(parsePlayerMessage(message)).toEqual({
      type: 'info',
      state: 1,
      timeMs: 12346,
      durationMs: 200_000,
      videoId: 'abcdefghijk',
    });
    expect(
      parsePlayerMessage(JSON.stringify({ event: 'infoDelivery', info: { volume: 30 } })),
    ).toEqual({ type: 'info' });
  });

  it('ignores anything else', () => {
    expect(parsePlayerMessage('not json')).toBeNull();
    expect(parsePlayerMessage(42)).toBeNull();
    expect(parsePlayerMessage(JSON.stringify({ event: 'somethingElse' }))).toBeNull();
    expect(parsePlayerMessage(JSON.stringify({ event: 'onError', info: 'x' }))).toBeNull();
  });
});

describe('frames', () => {
  it('match what the embed expects', () => {
    expect(JSON.parse(listeningFrame())).toEqual({ event: 'listening', id: 1, channel: 'widget' });
    expect(JSON.parse(commandFrame('seekTo', [20, true]))).toEqual({
      event: 'command',
      func: 'seekTo',
      args: [20, true],
    });
  });
});
