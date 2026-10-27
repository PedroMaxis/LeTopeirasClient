import { Track } from 'livekit-client';
import { settings } from '../../lib/settings';
import { useStore } from '../../lib/store';
import { useSession } from '../../state/session';

/**
 * Someone's voice volume and, while they share with audio in our room, their share's volume
 * (both 0–200 %, saved per user). Shown in the person's right-click menu.
 */
export function VolumeControls({ userId }: { userId: number }) {
  const { voice } = useSession();
  const volume = useStore(settings, (s) => s.userVolumes[String(userId)] ?? 100);
  const shareVolume = useStore(settings, (s) => s.shareVolumes[String(userId)] ?? 100);
  useStore(voice.store, (s) => s.version);
  const sharesAudio =
    voice.state.room?.remoteParticipants
      .get(String(userId))
      ?.getTrackPublication(Track.Source.ScreenShareAudio) !== undefined;

  return (
    <div className="context-volume">
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
        style={{ ['--fill' as string]: `${volume / 2}%` }}
        onChange={(e) => voice.setUserVolume(userId, Number(e.target.value))}
      />
      {volume !== 100 && (
        <button
          type="button"
          className="link context-reset"
          onClick={() => voice.setUserVolume(userId, 100)}
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
            onChange={(e) => voice.setShareVolume(userId, Number(e.target.value))}
          />
          {shareVolume !== 100 && (
            <button
              type="button"
              className="link context-reset"
              onClick={() => voice.setShareVolume(userId, 100)}
            >
              Voltar para 100%
            </button>
          )}
        </>
      )}
    </div>
  );
}
