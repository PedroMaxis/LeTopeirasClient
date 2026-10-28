import { useCallback, useState } from 'react';
import { useStore } from '../../lib/store';
import { useSession } from '../../state/session';
import type { LayoutActions } from '../MainLayout';
import { IconButton } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { SoundboardPopover } from '../voice/Soundboard';

const statusLabel = {
  idle: '',
  connecting: 'Conectando…',
  connected: 'Voz conectada',
  reconnecting: 'Reconectando voz…',
} as const;

/** "Voz conectada" box above the user panel, visible while in a voice channel. */
export function VoicePanel({ actions }: { actions: LayoutActions }) {
  const { chat, voice } = useSession();
  const channelId = useStore(voice.store, (s) => s.channelId);
  const status = useStore(voice.store, (s) => s.status);
  const pingMs = useStore(voice.store, (s) => s.pingMs);
  const sharing = useStore(voice.store, (s) => s.screenTrack !== null);
  const cameraOn = useStore(voice.store, (s) => s.cameraTrack !== null);
  const mutedSpeaking = useStore(voice.store, (s) => s.mutedSpeaking);
  const channel = useStore(chat.store, (s) => s.channels.find((c) => c.id === channelId));
  const muted = useStore(voice.store, (s) => s.muted);
  const deafened = useStore(voice.store, (s) => s.deafened);
  const [soundboardOpen, setSoundboardOpen] = useState(false);
  const closeSoundboard = useCallback(() => setSoundboardOpen(false), []);

  if (channelId === null) return null;

  return (
    <div className="voice-panel">
      <div className="voice-panel-row">
        <button
          type="button"
          className="voice-panel-info"
          onClick={() => actions.openView({ kind: 'voice', channelId })}
        >
          <div className={`voice-panel-status ${status}`}>{statusLabel[status]}</div>
          <div className="voice-panel-channel">
            {channel?.name ?? ''}
            {status === 'connected' && pingMs !== null && ` · ${pingMs} ms`}
          </div>
        </button>
        <IconButton icon="hangup" label="Desconectar" onClick={() => void voice.leave()} />
      </div>
      {mutedSpeaking && (
        <button
          type="button"
          className="muted-warning"
          title="Clique para ativar o microfone"
          onClick={() => void voice.toggleMute()}
        >
          <Icon name="micOff" size={16} />
          Você está mutado
        </button>
      )}
      <button
        type="button"
        className={`button secondary small ${sharing ? 'sharing' : ''}`}
        disabled={status !== 'connected'}
        onClick={() => (sharing ? void voice.stopScreenShare() : actions.openScreenPicker())}
      >
        <Icon name="screen" size={16} />
        {sharing ? 'Parar transmissão' : 'Tela'}
      </button>
      <div className="soundboard-anchor">
        {soundboardOpen && <SoundboardPopover onClose={closeSoundboard} />}
        <button
          type="button"
          className={`button secondary small ${soundboardOpen ? 'sharing' : ''}`}
          disabled={status !== 'connected' || muted || deafened}
          title={muted || deafened ? 'Desmute para usar o soundboard' : undefined}
          onClick={() => setSoundboardOpen((open) => !open)}
        >
          <Icon name="music" size={16} />
          Soundboard
        </button>
      </div>
      <button
        type="button"
        className={`button secondary small ${cameraOn ? 'sharing' : ''}`}
        disabled={status !== 'connected'}
        onClick={() => void voice.toggleCamera()}
      >
        <Icon name={cameraOn ? 'video' : 'videoOff'} size={16} />
        {cameraOn ? 'Desligar câmera' : 'Ligar câmera'}
      </button>
    </div>
  );
}
