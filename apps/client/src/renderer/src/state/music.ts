import type { MusicVideo } from '@letopeiras/shared';
import { errorMessage, type Api } from '../lib/api';
import { duckTarget, MUSIC_DUCK_STEP_MS, stepDuck } from '../lib/ducking';
import { expectedPositionMs, planSync } from '../lib/music-sync';
import { settings } from '../lib/settings';
import { Store } from '../lib/store';
import type { YouTubePlayer } from '../lib/youtube-player';
import { FATAL_ERRORS, PlayerState } from '../lib/youtube-protocol';
import type { ChatClient } from './chat';
import type { VoiceClient } from './voice';

const SYNC_INTERVAL_MS = 2000;

export interface MusicUiState {
  /** Last search; null before any. */
  results: MusicVideo[] | null;
  searching: boolean;
  error: string | null;
}

/** The element the panel reserves for the video; the player floats over it (null: mini player). */
export const musicSlot = new Store<{ el: HTMLElement | null }>({ el: null });

/**
 * "Ouvir junto": search, queue actions and keeping the local YouTube player in step with the
 * room's shared state (which `ChatClient` receives). The player itself is an iframe mounted
 * by `MusicPlayer`, attached here while it exists.
 */
export class MusicClient {
  readonly store = new Store<MusicUiState>({ results: null, searching: false, error: null });
  private player: YouTubePlayer | null = null;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly unsubscribe: () => void;
  private lastRoom: unknown = null;
  private lastVolume = -1;
  /** Track ids already reported to the server, so a repeated event isn't sent twice. */
  private readonly reported = new Set<string>();
  private searchId = 0;
  /** How far the music is lowered for someone speaking: 1 = not at all. */
  private duck = 1;
  private duckTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly api: Api,
    private readonly chat: ChatClient,
    private readonly voice: VoiceClient,
  ) {
    this.timer = setInterval(() => this.sync(), SYNC_INTERVAL_MS);
    // A new state from the server is applied at once, not at the next tick.
    const stopChat = this.chat.store.subscribe(() => {
      const room = this.room();
      if (room !== this.lastRoom) {
        this.lastRoom = room;
        this.sync();
      }
    });
    const stopSettings = settings.subscribe(() => {
      this.applyVolume();
      this.followDuck();
    });
    const stopVoice = this.voice.store.subscribe(() => this.followDuck());
    this.unsubscribe = () => {
      stopChat();
      stopSettings();
      stopVoice();
    };
  }

  dispose(): void {
    clearInterval(this.timer);
    clearInterval(this.duckTimer);
    this.unsubscribe();
    this.player = null;
  }

  /** The voice room we're in and its music, if any. */
  private room() {
    const channelId = this.voice.store.get().channelId;
    return channelId === null ? undefined : this.chat.store.get().music[channelId];
  }

  attach(player: YouTubePlayer | null): void {
    this.player = player;
    this.lastVolume = -1;
    this.reported.clear();
  }

  /** Called by the iframe's player events. */
  onPlayerReady(): void {
    this.applyVolume();
    this.sync();
  }

  onPlayerState(state: number): void {
    if (state === PlayerState.Ended) this.report('music.ended');
    else this.sync();
  }

  onPlayerError(code: number): void {
    if (FATAL_ERRORS.has(code)) this.report('music.failed');
  }

  /** `music.ended` / `music.failed` for the track this player has loaded, once. */
  private report(type: 'music.ended' | 'music.failed'): void {
    const channelId = this.voice.store.get().channelId;
    const track = this.room()?.current?.track;
    if (channelId === null || !track || track.videoId !== this.player?.videoId) return;
    const key = `${type}:${track.id}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.chat.sendMusic({ type, data: { channelId, trackId: track.id } });
  }

  /** Makes the player match the shared state: right video, right place, playing or paused. */
  sync(): void {
    const { player } = this;
    const room = this.room();
    const current = room?.current;
    if (!player?.ready || !room || !current) return;
    const actions = planSync(
      {
        videoId: current.track.videoId,
        paused: current.paused,
        expectedMs: expectedPositionMs(current, room.offset, Date.now()),
        durationMs: current.track.durationMs,
      },
      { videoId: player.videoId, state: player.state, timeMs: player.timeMs },
    );
    for (const action of actions) {
      switch (action.type) {
        case 'load':
          player.load(action.videoId, action.startMs);
          break;
        case 'seek':
          player.seek(action.ms);
          break;
        case 'play':
          player.play();
          break;
        case 'pause':
          player.pause();
          break;
      }
    }
  }

  private applyVolume(): void {
    const volume = Math.round(settings.get().musicVolume * this.duck);
    if (!this.player?.ready || volume === this.lastVolume) return;
    this.lastVolume = volume;
    this.player.setVolume(volume);
  }

  /** Eases the music's volume toward the ducked or normal level, in 100 ms steps. */
  private followDuck(): void {
    if (this.duckTimer) return;
    const s = settings.get();
    const target = () => duckTarget(s.ducking, this.voice.store.get().ducked, s.duckingAmount);
    if (this.duck === target()) return;
    this.duckTimer = setInterval(() => {
      const now = settings.get();
      const goal = duckTarget(now.ducking, this.voice.store.get().ducked, now.duckingAmount);
      this.duck = stepDuck(this.duck, goal, now.duckingAmount);
      this.applyVolume();
      if (this.duck === goal) {
        clearInterval(this.duckTimer);
        this.duckTimer = undefined;
      }
    }, MUSIC_DUCK_STEP_MS);
    // The first step shouldn't wait 100 ms when going down.
    this.duck = stepDuck(this.duck, target(), s.duckingAmount);
    this.applyVolume();
  }

  // -------------------------------------------------------------------------
  // What the person does

  async search(query: string): Promise<void> {
    const q = query.trim();
    if (!q) return;
    const id = ++this.searchId;
    this.store.set({ searching: true, error: null });
    try {
      const results = await this.api.musicSearch(q);
      if (id === this.searchId) this.store.set({ results, searching: false });
    } catch (err) {
      if (id === this.searchId) {
        this.store.set({ results: null, searching: false, error: errorMessage(err) });
      }
    }
  }

  clearResults(): void {
    this.searchId++;
    this.store.set({ results: null, searching: false, error: null });
  }

  add(videoId: string): void {
    this.act((channelId) => ({ type: 'music.add', data: { channelId, videoId } }));
  }

  remove(trackId: number): void {
    this.act((channelId) => ({ type: 'music.remove', data: { channelId, trackId } }));
  }

  toggle(): void {
    const paused = this.room()?.current?.paused;
    if (paused === undefined) return;
    this.act((channelId) => ({ type: paused ? 'music.play' : 'music.pause', data: { channelId } }));
  }

  skip(): void {
    this.act((channelId) => ({ type: 'music.skip', data: { channelId } }));
  }

  clearQueue(): void {
    this.act((channelId) => ({ type: 'music.clear', data: { channelId } }));
  }

  seek(positionMs: number): void {
    this.act((channelId) => ({
      type: 'music.seek',
      data: { channelId, positionMs: Math.max(0, Math.round(positionMs)) },
    }));
  }

  private act(build: (channelId: number) => Parameters<ChatClient['sendMusic']>[0]): void {
    const channelId = this.voice.store.get().channelId;
    if (channelId !== null) this.chat.sendMusic(build(channelId));
  }
}
