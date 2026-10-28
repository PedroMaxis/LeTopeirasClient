import { useEffect, useRef, useState } from 'react';
import { embedUrl, YouTubePlayer } from '../../lib/youtube-player';
import { useStore } from '../../lib/store';
import { musicSlot } from '../../state/music';
import { useSession } from '../../state/session';
import { IconButton } from '../ui/controls';

/**
 * The room's YouTube player. YouTube requires it to stay visible, so it is never hidden:
 * it floats over the panel's video slot while that is open, and otherwise sits in the
 * corner as a small player with controls. It is one iframe, mounted while something plays
 * and only moved by CSS (moving it in the DOM would reload the video).
 */
export function MusicPlayer() {
  const { chat, voice } = useSession();
  const channelId = useStore(voice.store, (s) => s.channelId);
  const videoId = useStore(chat.store, (s) =>
    channelId === null ? null : (s.music[channelId]?.current?.track.videoId ?? null),
  );
  if (channelId === null || videoId === null) return null;
  return <PlayerHost key={channelId} firstVideoId={videoId} />;
}

function PlayerHost({ firstVideoId }: { firstVideoId: string }) {
  const { music } = useSession();
  const slot = useStore(musicSlot, (s) => s.el);
  const wrapper = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  // Only seeds the iframe; later songs are loaded through the player.
  const [first] = useState(firstVideoId);

  useEffect(() => {
    const iframe = frame.current;
    if (!iframe) return;
    const player = new YouTubePlayer(
      iframe,
      {
        onReady: () => music.onPlayerReady(),
        onState: (state) => music.onPlayerState(state),
        onError: (code) => music.onPlayerError(code),
      },
      first,
    );
    music.attach(player);
    return () => {
      music.attach(null);
      player.dispose();
    };
  }, [music, first]);

  // Docked: follow the slot's rectangle (styles set directly, no re-render per frame).
  useEffect(() => {
    const el = wrapper.current;
    if (!el || !slot) return;
    let raf = 0;
    let last = '';
    const place = () => {
      const r = slot.getBoundingClientRect();
      const key = `${r.left},${r.top},${r.width},${r.height}`;
      if (key !== last) {
        last = key;
        el.style.left = `${r.left}px`;
        el.style.top = `${r.top}px`;
        el.style.width = `${r.width}px`;
        el.style.height = `${r.height}px`;
      }
      raf = requestAnimationFrame(place);
    };
    place();
    return () => {
      cancelAnimationFrame(raf);
      el.style.left = el.style.top = el.style.width = el.style.height = '';
    };
  }, [slot]);

  return (
    <div ref={wrapper} className={`music-player ${slot ? 'docked' : 'mini'}`}>
      <iframe
        ref={frame}
        className="music-frame"
        title="Música da sala"
        src={embedUrl(first)}
        allow="autoplay; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
      />
      {!slot && <MiniBar />}
    </div>
  );
}

function MiniBar() {
  const { chat, voice, music } = useSession();
  const channelId = useStore(voice.store, (s) => s.channelId);
  const current = useStore(chat.store, (s) =>
    channelId === null ? undefined : s.music[channelId]?.current,
  );
  if (!current) return null;
  return (
    <div className="music-mini-bar">
      <span className="music-mini-title" title={current.track.title}>
        {current.track.title}
      </span>
      <IconButton
        icon={current.paused ? 'play' : 'pause'}
        label={current.paused ? 'Tocar' : 'Pausar'}
        onClick={() => music.toggle()}
      />
      <IconButton icon="skip" label="Pular" onClick={() => music.skip()} />
    </div>
  );
}
