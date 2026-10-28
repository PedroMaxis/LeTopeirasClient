import { useEffect, useState, type FormEvent } from 'react';
import type { MusicTrack, MusicVideo } from '@letopeiras/shared';
import { expectedPositionMs } from '../../lib/music-sync';
import { settings, updateSettings } from '../../lib/settings';
import { useStore } from '../../lib/store';
import { musicSlot } from '../../state/music';
import { useSession } from '../../state/session';
import { IconButton } from '../ui/controls';
import { Icon } from '../ui/Icon';

const setSlot = (el: HTMLElement | null) => musicSlot.set({ el });

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Re-renders every `ms`, for the progress bar. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/** "Música" beside the voice stage: the video, what is playing, search, and the queue. */
export function MusicPanel({ channelId, onClose }: { channelId: number; onClose(): void }) {
  const { chat, music } = useSession();
  const room = useStore(chat.store, (s) => s.music[channelId]);
  const users = useStore(chat.store, (s) => s.users);
  const volume = useStore(settings, (s) => s.musicVolume);
  const results = useStore(music.store, (s) => s.results);
  const searching = useStore(music.store, (s) => s.searching);
  const error = useStore(music.store, (s) => s.error);
  const [query, setQuery] = useState('');
  const now = useNow(500);
  const current = room?.current ?? null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void music.search(query);
  };

  const duration = current?.track.durationMs ?? null;
  const position =
    current && room
      ? Math.min(expectedPositionMs(current, room.offset, now), duration ?? Infinity)
      : 0;

  return (
    <aside className="music-panel">
      <header className="chat-panel-header">
        <Icon name="music" size={18} />
        <strong className="music-panel-title">Música</strong>
        <IconButton icon="close" label="Fechar música" onClick={onClose} />
      </header>

      <div className="music-panel-body">
        {/* The player floats over this box (MusicPlayer). */}
        <div className="music-slot" ref={setSlot}>
          {!current && <span>Nada tocando. Busque uma música ou cole um link do YouTube.</span>}
        </div>

        {current && (
          <div className="music-now">
            <div className="music-now-title" title={current.track.title}>
              {current.track.title}
            </div>
            <div className="music-now-author">
              {current.track.author}
              {users[current.track.addedBy] &&
                ` · adicionada por ${users[current.track.addedBy]?.displayName}`}
            </div>
            <div className="music-progress">
              <span>{formatTime(position)}</span>
              {duration ? (
                <button
                  type="button"
                  className="music-bar"
                  aria-label="Ir para outro ponto da música"
                  onClick={(e) => {
                    const box = e.currentTarget.getBoundingClientRect();
                    music.seek(((e.clientX - box.left) / box.width) * duration);
                  }}
                >
                  <span style={{ width: `${(position / duration) * 100}%` }} />
                </button>
              ) : (
                <span className="music-bar-unknown">duração desconhecida</span>
              )}
              <span>{duration ? formatTime(duration) : ''}</span>
            </div>
            <div className="music-controls">
              <IconButton
                icon={current.paused ? 'play' : 'pause'}
                label={current.paused ? 'Tocar' : 'Pausar'}
                size={24}
                onClick={() => music.toggle()}
              />
              <IconButton icon="skip" label="Pular" size={24} onClick={() => music.skip()} />
              <Icon name="speaker" size={18} />
              <input
                type="range"
                className="slider"
                aria-label="Volume da música"
                min={0}
                max={100}
                step={5}
                value={volume}
                style={{ ['--fill' as string]: `${volume}%` }}
                onChange={(e) => updateSettings({ musicVolume: Number(e.target.value) })}
              />
            </div>
          </div>
        )}

        <form className="music-search" onSubmit={submit}>
          <input
            className="input"
            placeholder="Buscar música ou colar link"
            value={query}
            maxLength={200}
            onChange={(e) => setQuery(e.target.value)}
          />
          <IconButton
            icon="search"
            label="Buscar"
            onClick={() => void music.search(query)}
            disabled={searching}
          />
        </form>
        {error && <p className="music-error">{error}</p>}
        {results && (
          <div className="music-list">
            <div className="music-list-head">
              <span>{results.length ? 'Resultados' : 'Nada encontrado'}</span>
              <button type="button" className="link" onClick={() => music.clearResults()}>
                Limpar
              </button>
            </div>
            {results.map((video) => (
              <VideoRow key={video.videoId} video={video} onAdd={() => music.add(video.videoId)} />
            ))}
          </div>
        )}

        {room && room.queue.length > 0 && (
          <div className="music-list">
            <div className="music-list-head">
              <span>Fila ({room.queue.length})</span>
              <button type="button" className="link" onClick={() => music.clearQueue()}>
                Limpar fila
              </button>
            </div>
            {room.queue.map((track) => (
              <QueueRow
                key={track.id}
                track={track}
                by={users[track.addedBy]?.displayName}
                onRemove={() => music.remove(track.id)}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function VideoRow({ video, onAdd }: { video: MusicVideo; onAdd(): void }) {
  return (
    <div className="music-row">
      <img src={video.thumbnailUrl} alt="" loading="lazy" />
      <div className="music-row-text">
        <div className="music-row-title" title={video.title}>
          {video.title}
        </div>
        <div className="music-row-sub">
          {video.author}
          {video.durationMs !== null && ` · ${formatTime(video.durationMs)}`}
        </div>
      </div>
      <button type="button" className="button secondary small" onClick={onAdd}>
        Adicionar
      </button>
    </div>
  );
}

function QueueRow({
  track,
  by,
  onRemove,
}: {
  track: MusicTrack;
  by: string | undefined;
  onRemove(): void;
}) {
  return (
    <div className="music-row">
      <img src={track.thumbnailUrl} alt="" loading="lazy" />
      <div className="music-row-text">
        <div className="music-row-title" title={track.title}>
          {track.title}
        </div>
        <div className="music-row-sub">
          {by ?? ''}
          {track.durationMs !== null && ` · ${formatTime(track.durationMs)}`}
        </div>
      </div>
      <IconButton icon="close" label="Tirar da fila" size={18} onClick={onRemove} />
    </div>
  );
}
