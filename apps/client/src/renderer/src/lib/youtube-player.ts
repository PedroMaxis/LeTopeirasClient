import {
  commandFrame,
  listeningFrame,
  parsePlayerMessage,
  PLAYER_ORIGIN,
  PlayerState,
  type PlayerMessage,
} from './youtube-protocol';

export interface PlayerHandlers {
  onReady(): void;
  /** The player's state changed (see `PlayerState`). */
  onState(state: number): void;
  onError(code: number): void;
}

/** The embed URL for a video; `enablejsapi` makes it answer to the messages below. */
export const embedUrl = (videoId: string): string =>
  `${PLAYER_ORIGIN}/embed/${videoId}?` +
  new URLSearchParams({
    enablejsapi: '1',
    controls: '0',
    disablekb: '1',
    playsinline: '1',
    rel: '0',
    iv_load_policy: '3',
    autoplay: '1',
  });

/**
 * Drives a YouTube embed through postMessage: commands out, state and time back. Only
 * messages from this iframe are read. Until the embed answers, `listening` is repeated so a
 * slow load doesn't leave us deaf.
 */
export class YouTubePlayer {
  ready = false;
  state: number = PlayerState.Unstarted;
  timeMs = 0;
  durationMs: number | null = null;
  videoId: string | null;
  private heard = false;
  private readonly handshake: ReturnType<typeof setInterval>;

  constructor(
    private readonly iframe: HTMLIFrameElement,
    private readonly handlers: PlayerHandlers,
    initialVideoId: string,
  ) {
    this.videoId = initialVideoId;
    window.addEventListener('message', this.onMessage);
    this.handshake = setInterval(() => {
      if (this.heard) clearInterval(this.handshake);
      else this.post(listeningFrame());
    }, 500);
    iframe.addEventListener('load', this.onLoad);
  }

  dispose(): void {
    clearInterval(this.handshake);
    window.removeEventListener('message', this.onMessage);
    this.iframe.removeEventListener('load', this.onLoad);
  }

  load(videoId: string, startMs: number): void {
    this.videoId = videoId;
    this.timeMs = startMs;
    this.durationMs = null;
    this.send('loadVideoById', [{ videoId, startSeconds: startMs / 1000 }]);
  }

  play(): void {
    this.send('playVideo');
  }

  pause(): void {
    this.send('pauseVideo');
  }

  seek(ms: number): void {
    this.timeMs = ms;
    this.send('seekTo', [ms / 1000, true]);
  }

  /** 0–100. */
  setVolume(percent: number): void {
    this.send('setVolume', [Math.round(percent)]);
  }

  private send(func: string, args: unknown[] = []): void {
    this.post(commandFrame(func, args));
  }

  private post(frame: string): void {
    this.iframe.contentWindow?.postMessage(frame, PLAYER_ORIGIN);
  }

  private readonly onLoad = () => this.post(listeningFrame());

  private readonly onMessage = (event: MessageEvent) => {
    if (event.source !== this.iframe.contentWindow || event.origin !== PLAYER_ORIGIN) return;
    const message = parsePlayerMessage(event.data);
    if (!message) return;
    this.heard = true;
    this.apply(message);
  };

  private apply(message: PlayerMessage): void {
    switch (message.type) {
      case 'ready':
        this.ready = true;
        this.handlers.onReady();
        return;
      case 'state':
        this.setState(message.state);
        return;
      case 'error':
        this.handlers.onError(message.code);
        return;
      case 'info':
        // Info for another video (the previous one, while `load` is still taking effect)
        // would move our clock to the wrong place.
        if (message.videoId !== undefined && message.videoId !== this.videoId) return;
        if (message.timeMs !== undefined) this.timeMs = message.timeMs;
        if (message.durationMs !== undefined) this.durationMs = message.durationMs;
        if (message.state !== undefined) this.setState(message.state);
        return;
    }
  }

  private setState(state: number): void {
    if (state === this.state) return;
    this.state = state;
    this.handlers.onState(state);
  }
}
