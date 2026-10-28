import type { MusicCurrent } from '@letopeiras/shared';
import { PlayerState } from './youtube-protocol';

/** The player may be this far from the shared clock before we seek it. */
export const DRIFT_MS = 1500;
/** Paused players should sit on the exact position; a small slack avoids chasing rounding. */
const PAUSED_DRIFT_MS = 500;

/**
 * Where the current song is right now, on the server's clock: `offset` is
 * `serverNow - Date.now()` taken when the state arrived.
 */
export function expectedPositionMs(current: MusicCurrent, offset: number, now: number): number {
  if (current.paused) return current.positionMs;
  return current.positionMs + Math.max(0, now + offset - current.at);
}

export interface PlayerSnapshot {
  videoId: string | null;
  state: number;
  timeMs: number;
}

export type SyncAction =
  | { type: 'load'; videoId: string; startMs: number }
  | { type: 'seek'; ms: number }
  | { type: 'play' }
  | { type: 'pause' };

/**
 * What to do to the local player so it matches the shared state. An ad (for people without
 * Premium) only delays that player, which catches up with a seek when it ends.
 */
export function planSync(
  desired: { videoId: string; paused: boolean; expectedMs: number; durationMs: number | null },
  player: PlayerSnapshot,
): SyncAction[] {
  if (player.videoId !== desired.videoId) {
    return [{ type: 'load', videoId: desired.videoId, startMs: desired.expectedMs }];
  }
  const drift = Math.abs(player.timeMs - desired.expectedMs);
  const actions: SyncAction[] = [];
  const buffering = player.state === PlayerState.Buffering;
  const ended = player.state === PlayerState.Ended;

  if (desired.paused) {
    if (player.state === PlayerState.Playing || buffering) actions.push({ type: 'pause' });
    if (drift > PAUSED_DRIFT_MS && !buffering) {
      actions.push({ type: 'seek', ms: desired.expectedMs });
    }
    return actions;
  }

  // Our player finished a hair before the shared clock did: leave it until the server moves on.
  if (ended && (desired.durationMs === null || desired.expectedMs >= desired.durationMs - 3000)) {
    return actions;
  }
  if (drift > DRIFT_MS && !buffering) actions.push({ type: 'seek', ms: desired.expectedMs });
  if (
    player.state === PlayerState.Paused ||
    player.state === PlayerState.Cued ||
    player.state === PlayerState.Unstarted ||
    ended
  ) {
    actions.push({ type: 'play' });
  }
  return actions;
}
