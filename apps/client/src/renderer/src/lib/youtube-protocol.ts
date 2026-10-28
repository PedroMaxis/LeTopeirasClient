// The postMessage protocol of the YouTube embed (what its own iframe_api speaks). We use
// it directly: the official script would need youtube.com in `script-src`.

export const PLAYER_ORIGIN = 'https://www.youtube-nocookie.com';

/** `playerState` values. */
export const PlayerState = {
  Unstarted: -1,
  Ended: 0,
  Playing: 1,
  Paused: 2,
  Buffering: 3,
  Cued: 5,
} as const;

/** Errors that mean this video can't play here: unknown (100), embedding blocked (101, 150, 153). */
export const FATAL_ERRORS: ReadonlySet<number> = new Set([100, 101, 150, 153]);

export type PlayerMessage =
  | { type: 'ready' }
  | { type: 'state'; state: number }
  | { type: 'error'; code: number }
  /** Fields the player reports as they change (any subset). */
  | {
      type: 'info';
      state?: number;
      timeMs?: number;
      durationMs?: number;
      videoId?: string;
    };

/** Reads a message from the embed, or null for anything that isn't one of ours. */
export function parsePlayerMessage(data: unknown): PlayerMessage | null {
  let json: unknown = data;
  if (typeof data === 'string') {
    try {
      json = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof json !== 'object' || json === null) return null;
  const { event, info } = json as { event?: unknown; info?: unknown };
  switch (event) {
    case 'onReady':
      return { type: 'ready' };
    case 'onStateChange':
      return typeof info === 'number' ? { type: 'state', state: info } : null;
    case 'onError':
      return typeof info === 'number' ? { type: 'error', code: info } : null;
    case 'infoDelivery':
    case 'initialDelivery': {
      if (typeof info !== 'object' || info === null) return null;
      const i = info as {
        playerState?: unknown;
        currentTime?: unknown;
        duration?: unknown;
        videoData?: { video_id?: unknown } | null;
      };
      const out: Extract<PlayerMessage, { type: 'info' }> = { type: 'info' };
      if (typeof i.playerState === 'number') out.state = i.playerState;
      if (typeof i.currentTime === 'number') out.timeMs = Math.round(i.currentTime * 1000);
      if (typeof i.duration === 'number' && i.duration > 0) {
        out.durationMs = Math.round(i.duration * 1000);
      }
      if (typeof i.videoData?.video_id === 'string') out.videoId = i.videoData.video_id;
      return out;
    }
    default:
      return null;
  }
}

/** The frame that makes the embed start sending events. */
export const listeningFrame = () =>
  JSON.stringify({ event: 'listening', id: 1, channel: 'widget' });

export const commandFrame = (func: string, args: unknown[] = []) =>
  JSON.stringify({ event: 'command', func, args });
