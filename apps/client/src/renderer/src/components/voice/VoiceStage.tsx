import { useEffect, useRef, useState } from 'react';
import { Track, type Participant, type VideoTrack } from 'livekit-client';
import type { Channel, User } from '@letopeiras/shared';
import { shareModeLabels, shareQualities } from '../../lib/media';
import { useStore } from '../../lib/store';
import { useSession } from '../../state/session';
import type { LayoutActions } from '../MainLayout';
import { Avatar } from '../ui/Avatar';
import { Icon, type IconName } from '../ui/Icon';
import { useVolumeMenu } from './VolumeMenu';

interface Share {
  participant: Participant;
  track: VideoTrack;
  height: number | undefined;
}

export function VoiceStage({ channel, actions }: { channel: Channel; actions: LayoutActions }) {
  const { chat, voice } = useSession();
  useStore(voice.store, (s) => s.version);
  const room = useStore(voice.store, (s) => s.room);
  const status = useStore(voice.store, (s) => s.status);
  const muted = useStore(voice.store, (s) => s.muted);
  const deafened = useStore(voice.store, (s) => s.deafened);
  const sharing = useStore(voice.store, (s) => s.screenTrack !== null);
  const users = useStore(chat.store, (s) => s.users);
  const voiceState = useStore(chat.store, (s) => s.voice[channel.id]);
  const [featuredId, setFeaturedId] = useState<string | null>(null);
  const volumeMenu = useVolumeMenu();

  const participants: Participant[] = room
    ? [room.localParticipant, ...room.remoteParticipants.values()]
    : [];
  const shares: Share[] = participants.flatMap((participant) => {
    const publication = participant.getTrackPublication(Track.Source.ScreenShare);
    const track = publication?.videoTrack;
    return track ? [{ participant, track, height: publication.dimensions?.height }] : [];
  });
  const featured = shares.find((s) => s.participant.identity === featuredId) ?? shares[0];

  const userOf = (p: Participant): User | undefined => users[Number(p.identity)];
  const selfState = (p: Participant) => voiceState?.find((v) => String(v.userId) === p.identity);

  return (
    <section className="voice-stage">
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
      </header>

      <div className="stage-body">
        {featured ? (
          <FeaturedShare
            share={featured}
            name={userOf(featured.participant)?.displayName ?? featured.participant.name ?? ''}
            isLocal={featured.participant === room?.localParticipant}
          />
        ) : (
          <div className="stage-empty">
            <Icon name="screens" size={48} />
            <p>Ninguém está transmitindo. Clique em compartilhar para mostrar sua tela.</p>
          </div>
        )}

        <div className="stage-tiles">
          {participants.map((p) => {
            const state = selfState(p);
            const isLocal = p === room?.localParticipant;
            const pMuted = isLocal ? muted || deafened : (state?.muted ?? !p.isMicrophoneEnabled);
            const pDeafened = isLocal ? deafened : (state?.deafened ?? false);
            const live = shares.some((s) => s.participant === p);
            return (
              <button
                type="button"
                key={p.identity}
                className={`stage-tile ${p.isSpeaking ? 'speaking' : ''} ${live ? 'live' : ''}`}
                onClick={() => live && setFeaturedId(p.identity)}
                onContextMenu={volumeMenu.open(
                  Number(p.identity),
                  userOf(p)?.displayName ?? p.name ?? '',
                )}
                title={live ? 'Ver transmissão' : 'Clique direito: volume'}
              >
                <Avatar user={userOf(p)} size={64} />
                <span className="stage-tile-label">
                  <span className="overlay-chip">{userOf(p)?.displayName ?? p.name}</span>
                  {pDeafened ? (
                    <span className="overlay-icon">
                      <Icon name="headphonesOff" size={14} />
                    </span>
                  ) : (
                    pMuted && (
                      <span className="overlay-icon">
                        <Icon name="micOff" size={14} />
                      </span>
                    )
                  )}
                </span>
                {live && <span className="live-badge stage-tile-live">AO VIVO</span>}
              </button>
            );
          })}
        </div>

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

function FeaturedShare({ share, name, isLocal }: { share: Share; name: string; isLocal: boolean }) {
  const { voice } = useSession();
  const mode = useStore(voice.store, (s) => s.shareMode);
  const quality = useStore(voice.store, (s) => s.shareQuality);
  const sharingAudio = useStore(voice.store, (s) => s.sharingAudio);
  const identity = share.participant.identity;
  const audioMuted = useStore(voice.store, (s) => s.mutedShares.has(identity));
  const hasAudio = isLocal
    ? sharingAudio
    : share.participant.getTrackPublication(Track.Source.ScreenShareAudio) !== undefined;
  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    share.track.attach(el);
    return () => {
      share.track.detach(el);
    };
  }, [share.track]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void container.current?.requestFullscreen();
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

  return (
    <div className="featured" ref={container} onDoubleClick={toggleFullscreen}>
      <video ref={video} autoPlay playsInline muted />
      <div className="featured-top">
        <span className="live-badge">AO VIVO</span>
        {info && <span className="overlay-chip">{info}</span>}
      </div>
      <div className="featured-name overlay-chip">
        {name}
        {isLocal && ' (sua tela)'}
      </div>
      <div className="featured-actions">
        {hasAudio && !isLocal && (
          <button
            type="button"
            className="overlay-button"
            aria-label={audioMuted ? 'Ouvir a transmissão' : 'Silenciar a transmissão'}
            title={audioMuted ? 'Ouvir a transmissão' : 'Silenciar a transmissão'}
            onClick={() => voice.toggleShareAudio(identity)}
          >
            <Icon name={audioMuted ? 'speakerOff' : 'speaker'} size={18} />
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
    </div>
  );
}
