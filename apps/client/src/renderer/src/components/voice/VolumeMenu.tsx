import { useEffect, useState, type MouseEvent } from 'react';
import { Track } from 'livekit-client';
import { settings } from '../../lib/settings';
import { useStore } from '../../lib/store';
import { useSession } from '../../state/session';

interface Target {
  userId: number;
  name: string;
  x: number;
  y: number;
}

/**
 * Right-click menu with someone's voice volume and, while they share with audio in our room,
 * their share's volume (both 0–200 %, saved per user). Returns the handler to put on
 * `onContextMenu` and the element to render.
 */
export function useVolumeMenu() {
  const [target, setTarget] = useState<Target | null>(null);
  const { chat } = useSession();
  const meId = useStore(chat.store, (s) => s.me?.id);

  const open = (userId: number, name: string) => (event: MouseEvent) => {
    event.preventDefault();
    if (userId === meId) return;
    setTarget({ userId, name, x: event.clientX, y: event.clientY });
  };

  const menu = target ? <VolumeMenu target={target} onClose={() => setTarget(null)} /> : null;
  return { open, menu };
}

function VolumeMenu({ target, onClose }: { target: Target; onClose(): void }) {
  const { voice } = useSession();
  const volume = useStore(settings, (s) => s.userVolumes[String(target.userId)] ?? 100);
  const shareVolume = useStore(settings, (s) => s.shareVolumes[String(target.userId)] ?? 100);
  useStore(voice.store, (s) => s.version);
  const sharesAudio =
    voice.state.room?.remoteParticipants
      .get(String(target.userId))
      ?.getTrackPublication(Track.Source.ScreenShareAudio) !== undefined;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Keep the menu inside the window.
  const left = Math.min(target.x, window.innerWidth - 240);
  const top = Math.min(target.y, window.innerHeight - (sharesAudio ? 200 : 120));

  return (
    <div
      className="context-backdrop"
      onMouseDown={onClose}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="context-menu" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="context-title">{target.name}</div>
        <label className="field-label" htmlFor="user-volume">
          VOLUME DO USUÁRIO <span className="slider-value">{volume}%</span>
        </label>
        <input
          id="user-volume"
          type="range"
          className="slider"
          min={0}
          max={200}
          step={5}
          value={volume}
          autoFocus
          style={{ ['--fill' as string]: `${volume / 2}%` }}
          onChange={(e) => voice.setUserVolume(target.userId, Number(e.target.value))}
        />
        {volume !== 100 && (
          <button
            type="button"
            className="link context-reset"
            onClick={() => voice.setUserVolume(target.userId, 100)}
          >
            Voltar para 100%
          </button>
        )}
        {sharesAudio && (
          <>
            <label className="field-label" htmlFor="share-volume">
              VOLUME DA TRANSMISSÃO <span className="slider-value">{shareVolume}%</span>
            </label>
            <input
              id="share-volume"
              type="range"
              className="slider"
              min={0}
              max={200}
              step={5}
              value={shareVolume}
              style={{ ['--fill' as string]: `${shareVolume / 2}%` }}
              onChange={(e) => voice.setShareVolume(target.userId, Number(e.target.value))}
            />
            {shareVolume !== 100 && (
              <button
                type="button"
                className="link context-reset"
                onClick={() => voice.setShareVolume(target.userId, 100)}
              >
                Voltar para 100%
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
