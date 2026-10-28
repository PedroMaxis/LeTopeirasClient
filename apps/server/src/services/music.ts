import {
  LIMITS,
  type MusicChannelState,
  type MusicCurrent,
  type MusicTrack,
  type MusicVideo,
} from '@letopeiras/shared';
import { AppError, conflict } from '../lib/errors';

/** A room's queue outlives its last person for this long, in case they are only reconnecting. */
export const EMPTY_ROOM_GRACE_MS = 60_000;
/** An `ended` from a player only counts this close to the end (ads and lag can fire it early). */
const ENDED_TOLERANCE_MS = 5_000;

interface Room {
  current: MusicCurrent | null;
  queue: MusicTrack[];
  /** Moves on when the current song's duration runs out. */
  advanceTimer: NodeJS.Timeout | undefined;
  /** Drops the room's music a while after the last person left. */
  emptyTimer: NodeJS.Timeout | undefined;
}

export interface MusicStoreDeps {
  /** A room's music changed: tell whoever sees the channel. */
  onChange(channelId: number): void;
  /** The song couldn't be played and was skipped. */
  onFailed(channelId: number, track: MusicTrack): void;
  now?: () => number;
}

/**
 * Per voice room: what is playing and the queue, in memory like the voice state (a
 * restart loses it). Clients play the songs themselves; the server only keeps the shared
 * clock: `current` says where the song was at `at`, and everyone derives the rest.
 */
export class MusicStore {
  private readonly rooms = new Map<number, Room>();
  private nextTrackId = 1;
  private readonly now: () => number;

  constructor(private readonly deps: MusicStoreDeps) {
    this.now = deps.now ?? Date.now;
  }

  get(channelId: number): MusicChannelState {
    const room = this.rooms.get(channelId);
    return {
      channelId,
      current: room?.current ?? null,
      queue: room?.queue ?? [],
      serverNow: this.now(),
    };
  }

  /** Rooms that have something, for `ready`. */
  all(): MusicChannelState[] {
    return [...this.rooms.entries()]
      .filter(([, room]) => room.current || room.queue.length)
      .map(([id]) => this.get(id));
  }

  /** Queues a song; it starts at once when nothing is playing. */
  add(channelId: number, video: MusicVideo, addedBy: number): void {
    const room = this.room(channelId);
    if (room.queue.length >= LIMITS.musicQueue) {
      throw conflict(`A fila está cheia (${LIMITS.musicQueue} músicas)`, 'music_queue_full');
    }
    const track: MusicTrack = { ...video, id: this.nextTrackId++, addedBy };
    if (room.current) room.queue.push(track);
    else this.start(channelId, room, track);
    this.deps.onChange(channelId);
  }

  /** Takes a song off the queue; removing the one playing skips it. */
  remove(channelId: number, trackId: number): void {
    const room = this.rooms.get(channelId);
    if (!room) return;
    if (room.current?.track.id === trackId) {
      this.advance(channelId, room);
    } else {
      const before = room.queue.length;
      room.queue = room.queue.filter((t) => t.id !== trackId);
      if (room.queue.length === before) return;
    }
    this.deps.onChange(channelId);
  }

  play(channelId: number): void {
    const room = this.rooms.get(channelId);
    if (!room?.current?.paused) return;
    room.current = { ...room.current, paused: false, at: this.now() };
    this.schedule(channelId, room);
    this.deps.onChange(channelId);
  }

  pause(channelId: number): void {
    const room = this.rooms.get(channelId);
    if (!room?.current || room.current.paused) return;
    const now = this.now();
    room.current = {
      ...room.current,
      paused: true,
      positionMs: this.positionOf(room.current, now),
      at: now,
    };
    this.schedule(channelId, room);
    this.deps.onChange(channelId);
  }

  seek(channelId: number, positionMs: number): void {
    const room = this.rooms.get(channelId);
    if (!room?.current) return;
    const { durationMs } = room.current.track;
    // Seeking to the very end ends the song; anything past it is clamped just before.
    const position = durationMs === null ? positionMs : Math.min(positionMs, durationMs - 1);
    room.current = { ...room.current, positionMs: position, at: this.now() };
    this.schedule(channelId, room);
    this.deps.onChange(channelId);
  }

  skip(channelId: number): void {
    const room = this.rooms.get(channelId);
    if (!room?.current) return;
    this.advance(channelId, room);
    this.deps.onChange(channelId);
  }

  clear(channelId: number): void {
    const room = this.rooms.get(channelId);
    if (!room?.queue.length) return;
    room.queue = [];
    this.deps.onChange(channelId);
  }

  /** A player reports the end of `trackId`. Counts when close to the end, or with no duration. */
  ended(channelId: number, trackId: number): void {
    const room = this.rooms.get(channelId);
    const current = room?.current;
    if (!room || !current || current.track.id !== trackId) return;
    const { durationMs } = current.track;
    if (
      durationMs !== null &&
      this.positionOf(current, this.now()) < durationMs - ENDED_TOLERANCE_MS
    ) {
      return;
    }
    this.advance(channelId, room);
    this.deps.onChange(channelId);
  }

  /** A player can't play `trackId`: skip it and say so. */
  failed(channelId: number, trackId: number): void {
    const room = this.rooms.get(channelId);
    if (room?.current?.track.id !== trackId) return;
    const { track } = room.current;
    this.advance(channelId, room);
    this.deps.onFailed(channelId, track);
    this.deps.onChange(channelId);
  }

  /** Keeps the queue while people are in the room; drops it after a minute of nobody. */
  roomChanged(channelId: number, participants: number): void {
    const room = this.rooms.get(channelId);
    if (!room) return;
    if (participants > 0) {
      clearTimeout(room.emptyTimer);
      room.emptyTimer = undefined;
      return;
    }
    if (room.emptyTimer) return;
    room.emptyTimer = setTimeout(() => {
      this.dropRoom(channelId);
      this.deps.onChange(channelId);
    }, EMPTY_ROOM_GRACE_MS);
    room.emptyTimer.unref();
  }

  /** Where the current song is at `now`. */
  positionOf(current: MusicCurrent, now: number): number {
    return current.paused ? current.positionMs : current.positionMs + Math.max(0, now - current.at);
  }

  close(): void {
    for (const id of [...this.rooms.keys()]) this.dropRoom(id);
  }

  // -------------------------------------------------------------------------

  private room(channelId: number): Room {
    let room = this.rooms.get(channelId);
    if (!room) {
      room = { current: null, queue: [], advanceTimer: undefined, emptyTimer: undefined };
      this.rooms.set(channelId, room);
    }
    return room;
  }

  private dropRoom(channelId: number): void {
    const room = this.rooms.get(channelId);
    if (!room) return;
    clearTimeout(room.advanceTimer);
    clearTimeout(room.emptyTimer);
    this.rooms.delete(channelId);
  }

  private start(channelId: number, room: Room, track: MusicTrack): void {
    room.current = { track, paused: false, positionMs: 0, at: this.now() };
    this.schedule(channelId, room);
  }

  private advance(channelId: number, room: Room): void {
    const next = room.queue.shift();
    if (next) this.start(channelId, room, next);
    else {
      room.current = null;
      this.schedule(channelId, room);
    }
  }

  /** (Re)arms the timer that moves on when the song's duration runs out. */
  private schedule(channelId: number, room: Room): void {
    clearTimeout(room.advanceTimer);
    room.advanceTimer = undefined;
    const { current } = room;
    if (!current || current.paused || current.track.durationMs === null) return;
    const left = current.track.durationMs - this.positionOf(current, this.now());
    room.advanceTimer = setTimeout(
      () => {
        room.advanceTimer = undefined;
        this.advance(channelId, room);
        this.deps.onChange(channelId);
      },
      Math.max(0, left),
    );
    room.advanceTimer.unref();
  }
}

/** The error for music actions from someone who isn't in the room. */
export const notInRoom = () =>
  new AppError(403, 'not_in_voice', 'Entre na sala de voz para mexer na música');
