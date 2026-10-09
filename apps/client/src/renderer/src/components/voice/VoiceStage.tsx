import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { Track, type Participant, type VideoTrack } from 'livekit-client';
import type { Channel, User } from '@letopeiras/shared';
import { errorMessage } from '../../lib/api';
import { shareModeLabels, shareQualities } from '../../lib/media';
import { settings } from '../../lib/settings';
import { useStore } from '../../lib/store';
import { showToast } from '../../lib/toast';
import { useSession } from '../../state/session';
import { isWatching } from '../../state/voice';
import type { LayoutActions } from '../MainLayout';
import { Avatar } from '../ui/Avatar';
import { Icon, type IconName } from '../ui/Icon';
import { useVolumeMenu } from './VolumeMenu';

interface Share {
  participant: Participant;
  isLocal: boolean;
  /** Missing while we're not subscribed (not watching, or still subscribing). */
  track: VideoTrack | undefined;
  height: number | undefined;
  name: string;
  user: User | undefined;
  watching: boolean;
}

const TILE_GAP = 12;
const TILE_ASPECT = 16 / 9;

/**
 * Largest 16:9 tile size that fits `count` tiles in the element, trying every column count
 * (like Discord's grid).
 */
function useTileSize(el: HTMLElement | null, count: number) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);

  let best = 0;
  for (let cols = 1; cols <= Math.max(1, count); cols++) {
    const rows = Math.ceil(count / cols);
    const byWidth = (box.width - TILE_GAP * (cols - 1)) / cols;
    const byHeight = ((box.height - TILE_GAP * (rows - 1)) / rows) * TILE_ASPECT;
    best = Math.max(best, Math.min(byWidth, byHeight));
  }
  const width = Math.max(0, Math.floor(best));
  return { width, height: Math.floor(width / TILE_ASPECT) };
}

/**
 * Stays mounted (only `hidden`) while we're in the room and a text channel is on screen, so
 * a share's picture-in-picture window survives switching channels.
 *
 * Grid (default): every share side by side, sized to fit, participants in a strip below; with
 * no shares, the participants fill the grid. Focus (click a share): that share large, the
 * other shares and the participants in the strip.
 */
export function VoiceStage({
  channel,
  actions,
  hidden,
}: {
  channel: Channel;
  actions: LayoutActions;
  hidden: boolean;
}) {
  const { chat, voice } = useSession();
  useStore(voice.store, (s) => s.version);
  const room = useStore(voice.store, (s) => s.room);
  const status = useStore(voice.store, (s) => s.status);
  const muted = useStore(voice.store, (s) => s.muted);
  const deafened = useStore(voice.store, (s) => s.deafened);
  const sharing = useStore(voice.store, (s) => s.screenTrack !== null);
  const shareWatch = useStore(voice.store, (s) => s.shareWatch);
  const autoWatch = useStore(settings, (s) => s.autoWatchShares);
  const users = useStore(chat.store, (s) => s.users);
  const voiceState = useStore(chat.store, (s) => s.voice[channel.id]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const volumeMenu = useVolumeMenu();
  // State, not a ref: the grid element comes and goes with focus mode.
  const [grid, setGrid] = useState<HTMLDivElement | null>(null);

  const participants: Participant[] = room
    ? [room.localParticipant, ...room.remoteParticipants.values()]
    : [];
  const userOf = (p: Participant): User | undefined => users[Number(p.identity)];
  const nameOf = (p: Participant) => userOf(p)?.displayName ?? p.name ?? '';

  // By publication, not track: a share we don't watch has no track but is still live.
  const shares: Share[] = participants.flatMap((participant) => {
    const publication = participant.getTrackPublication(Track.Source.ScreenShare);
    if (!publication) return [];
    const isLocal = participant === room?.localParticipant;
    return [
      {
        participant,
        isLocal,
        track: publication.videoTrack,
        height: publication.dimensions?.height,
        name: nameOf(participant),
        user: userOf(participant),
        watching: isWatching(shareWatch, participant.identity, isLocal, autoWatch),
      },
    ];
  });
  const focused = shares.find((s) => s.participant.identity === focusedId);
  const gridCount = focused ? 0 : shares.length || participants.length;
  const tile = useTileSize(grid, gridCount);

  const participantTile = (p: Participant, strip: boolean) => {
    const state = voiceState?.find((v) => String(v.userId) === p.identity);
    const isLocal = p === room?.localParticipant;
    const live = shares.some((s) => s.participant === p);
    return (
      <ParticipantTile
        key={`p-${p.identity}`}
        participant={p}
        user={userOf(p)}
        name={nameOf(p)}
        muted={isLocal ? muted || deafened : (state?.muted ?? !p.isMicrophoneEnabled)}
        deafened={isLocal ? deafened : (state?.deafened ?? false)}
        live={live}
        style={strip ? undefined : tile}
        onClick={live ? () => setFocusedId(p.identity) : undefined}
        onContextMenu={volumeMenu.open(Number(p.identity), nameOf(p))}
      />
    );
  };

  return (
    <section className="voice-stage" hidden={hidden}>
      <header className="main-header stage-header">
        <Icon name="speaker" size={22} />
        <span className="main-header-title">{channel.name}</span>
        <span className="main-header-sub">
          {status === 'connected'
            ? `${participants.length} ${participants.length === 1 ? 'pessoa' : 'pessoas'}`
            : status === 'reconnecting'
              ? 'Reconectando…'
              : 'Conectando…'}
        </span>
        {focused && (
          <div className="main-header-actions">
            <button
              type="button"
              className="button secondary small"
              onClick={() => setFocusedId(null)}
            >
              <Icon name="grid" size={16} />
              Ver todas
            </button>
          </div>
        )}
      </header>

      <div className="stage-body">
        {focused ? (
          <div className="stage-focus">
            <ShareTile share={focused} large />
          </div>
        ) : (
          <div className="stage-grid" ref={setGrid}>
            {shares.length > 0
              ? shares.map((share) => (
                  <ShareTile
                    key={`s-${share.participant.identity}`}
                    share={share}
                    style={tile}
                    onSelect={() => setFocusedId(share.participant.identity)}
                  />
                ))
              : participants.map((p) => participantTile(p, false))}
          </div>
        )}

        {(focused || shares.length > 0) && (
          <div className="stage-strip">
            {shares
              .filter((s) => s !== focused)
              .map((share) => (
                <ShareTile
                  key={`s-${share.participant.identity}`}
                  share={share}
                  small
                  onSelect={() => setFocusedId(share.participant.identity)}
                />
              ))}
            {participants.map((p) => participantTile(p, true))}
          </div>
        )}

        {volumeMenu.menu}
        <div className="stage-controls">
          <StageButton
            icon={muted || deafened ? 'micOff' : 'mic'}
            label={muted ? 'Ativar microfone' : 'Silenciar microfone'}
            off={muted || deafened}
            onClick={() => void voice.toggleMute()}
          />
          <StageButton
            icon={deafened ? 'headphonesOff' : 'headphones'}
            label={deafened ? 'Voltar a ouvir' : 'Ensurdecer'}
            off={deafened}
            onClick={() => void voice.toggleDeafen()}
          />
          <StageButton
            icon="screen"
            label={sharing ? 'Parar transmissão' : 'Compartilhar tela'}
            accent={sharing}
            disabled={status !== 'connected'}
            onClick={() => (sharing ? void voice.stopScreenShare() : actions.openScreenPicker())}
          />
          <StageButton
            icon="settings"
            label="Configurações de voz"
            onClick={() => actions.openSettings()}
          />
          <StageButton
            icon="hangup"
            label="Sair do canal"
            leave
            onClick={() => void voice.leave()}
          />
        </div>
      </div>
    </section>
  );
}

function StageButton(props: {
  icon: IconName;
  label: string;
  onClick(): void;
  off?: boolean;
  accent?: boolean;
  leave?: boolean;
  disabled?: boolean;
}) {
  const kind = props.leave ? 'leave' : props.accent ? 'accent' : props.off ? 'off' : '';
  return (
    <button
      type="button"
      className={`stage-button ${kind}`}
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size={22} />
    </button>
  );
}

function ParticipantTile(props: {
  participant: Participant;
  user: User | undefined;
  name: string;
  muted: boolean;
  deafened: boolean;
  live: boolean;
  style?: { width: number; height: number } | undefined;
  onClick?: (() => void) | undefined;
  onContextMenu(event: MouseEvent): void;
}) {
  return (
    <button
      type="button"
      className={`stage-tile ${props.participant.isSpeaking ? 'speaking' : ''} ${props.onClick ? 'live' : ''}`}
      style={props.style}
      onClick={props.onClick}
      onContextMenu={props.onContextMenu}
      title={props.onClick ? 'Ver transmissão' : 'Clique direito: volume'}
    >
      <Avatar user={props.user} size={props.style ? Math.min(96, props.style.height / 2) : 64} />
      <span className="stage-tile-label">
        <span className="overlay-chip">{props.name}</span>
        {props.deafened ? (
          <span className="overlay-icon">
            <Icon name="headphonesOff" size={14} />
          </span>
        ) : (
          props.muted && (
            <span className="overlay-icon">
              <Icon name="micOff" size={14} />
            </span>
          )
        )}
      </span>
      {props.live && <span className="live-badge stage-tile-live">AO VIVO</span>}
    </button>
  );
}

/**
 * One screen share. `large`: the focused one; `small`: in the strip (name and badge only);
 * otherwise a grid tile. Not watching shows "Assistir" instead of the video.
 */
function ShareTile({
  share,
  large = false,
  small = false,
  style,
  onSelect,
}: {
  share: Share;
  large?: boolean;
  small?: boolean;
  style?: { width: number; height: number } | undefined;
  onSelect?: () => void;
}) {
  const { voice } = useSession();
  const mode = useStore(voice.store, (s) => s.shareMode);
  const quality = useStore(voice.store, (s) => s.shareQuality);
  const sharingAudio = useStore(voice.store, (s) => s.sharingAudio);
  const { participant, isLocal, watching } = share;
  const identity = participant.identity;
  const audioMuted = useStore(voice.store, (s) => s.mutedShares.has(identity));
  const volume = useStore(settings, (s) => s.shareVolumes[identity] ?? 100);
  const hasAudio = isLocal
    ? sharingAudio
    : participant.getTrackPublication(Track.Source.ScreenShareAudio) !== undefined;
  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [inPip, setInPip] = useState(false);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const onEnter = () => setInPip(true);
    const onLeave = () => setInPip(false);
    el.addEventListener('enterpictureinpicture', onEnter);
    el.addEventListener('leavepictureinpicture', onLeave);
    return () => {
      el.removeEventListener('enterpictureinpicture', onEnter);
      el.removeEventListener('leavepictureinpicture', onLeave);
    };
  }, [watching]);

  useEffect(() => {
    const el = video.current;
    const track = share.track;
    if (!el || !track || !watching) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [share.track, watching]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void container.current?.requestFullscreen();
  };

  const togglePip = () => {
    if (document.pictureInPictureElement === video.current) {
      void document.exitPictureInPicture();
      return;
    }
    video.current?.requestPictureInPicture().catch((err: unknown) => {
      showToast(`Não deu para abrir a janela flutuante: ${errorMessage(err)}`);
    });
  };

  const info = [
    isLocal
      ? `${shareQualities[quality].label} fps · Modo ${shareModeLabels[mode]}`
      : share.height
        ? `${share.height}p`
        : null,
    hasAudio ? 'com áudio' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const variant = large ? 'large' : small ? 'small' : 'grid';
  return (
    <div
      className={`share-tile ${variant} ${watching ? '' : 'not-watching'}`}
      ref={container}
      style={style}
      onClick={onSelect}
      onDoubleClick={large ? toggleFullscreen : undefined}
      title={onSelect && small ? `Ver a transmissão de ${share.name}` : undefined}
    >
      {watching ? (
        <video ref={video} autoPlay playsInline muted />
      ) : (
        <div className="share-tile-idle">
          <Avatar user={share.user} size={small ? 40 : 64} />
          {!small && (
            <button
              type="button"
              className="button primary"
              onClick={(e) => {
                e.stopPropagation();
                voice.setWatching(identity, true);
              }}
            >
              <Icon name="eye" size={18} />
              {isLocal ? 'Mostrar prévia' : 'Assistir'}
            </button>
          )}
        </div>
      )}
      <div className="featured-top">
        <span className={`live-badge ${small ? 'small' : ''}`}>AO VIVO</span>
        {!small && info && <span className="overlay-chip">{info}</span>}
      </div>
      <div className="featured-name overlay-chip">
        <Icon name="screen" size={14} />
        {share.name}
        {isLocal && ' (sua tela)'}
      </div>
      {!small && watching && (
        <div className="featured-actions" onClick={(e) => e.stopPropagation()}>
          {hasAudio && !isLocal && (
            <div className="share-volume">
              <input
                type="range"
                className="slider"
                aria-label="Volume da transmissão"
                title={`Volume da transmissão: ${volume}%`}
                min={0}
                max={200}
                step={5}
                value={audioMuted ? 0 : volume}
                style={{ ['--fill' as string]: `${(audioMuted ? 0 : volume) / 2}%` }}
                onChange={(e) => {
                  // Dragging the slider of a muted share unmutes it, like a video player.
                  if (audioMuted) voice.toggleShareAudio(identity);
                  voice.setShareVolume(Number(identity), Number(e.target.value));
                }}
              />
              <button
                type="button"
                className="overlay-button"
                aria-label={audioMuted ? 'Ouvir a transmissão' : 'Silenciar a transmissão'}
                title={audioMuted ? 'Ouvir a transmissão' : 'Silenciar a transmissão'}
                onClick={() => voice.toggleShareAudio(identity)}
              >
                <Icon name={audioMuted || volume === 0 ? 'speakerOff' : 'speaker'} size={18} />
              </button>
            </div>
          )}
          <button
            type="button"
            className="overlay-button"
            aria-label={isLocal ? 'Esconder a prévia' : 'Parar de assistir'}
            title={isLocal ? 'Esconder a prévia' : 'Parar de assistir'}
            onClick={() => voice.setWatching(identity, false)}
          >
            <Icon name="eyeOff" size={18} />
          </button>
          {document.pictureInPictureEnabled && (
            <button
              type="button"
              className={`overlay-button ${inPip ? 'active' : ''}`}
              aria-label={inPip ? 'Fechar janela flutuante' : 'Janela flutuante'}
              title={inPip ? 'Fechar janela flutuante' : 'Janela flutuante'}
              onClick={togglePip}
            >
              <Icon name="pip" size={18} />
            </button>
          )}
          <button
            type="button"
            className="overlay-button"
            aria-label="Tela cheia"
            title="Tela cheia"
            onClick={toggleFullscreen}
          >
            <Icon name="fullscreen" size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
