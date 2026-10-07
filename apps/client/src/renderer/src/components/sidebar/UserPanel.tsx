import { useStore } from '../../lib/store';
import { useSession } from '../../state/session';
import type { LayoutActions } from '../MainLayout';
import { Avatar } from '../ui/Avatar';
import { IconButton } from '../ui/controls';

/** Bottom-left: who I am, plus mute / deafen / settings. */
export function UserPanel({ actions }: { actions: LayoutActions }) {
  const { chat, voice } = useSession();
  const me = useStore(chat.store, (s) => s.me);
  const muted = useStore(voice.store, (s) => s.muted);
  const deafened = useStore(voice.store, (s) => s.deafened);

  return (
    <div className="user-panel">
      <Avatar user={me ?? undefined} size={32} status="online" />
      <div className="user-panel-names">
        <div className="user-panel-name">{me?.displayName}</div>
        <div className="user-panel-sub">@{me?.username}</div>
      </div>
      <IconButton
        icon={muted || deafened ? 'micOff' : 'mic'}
        label={muted ? 'Ativar microfone' : 'Silenciar microfone'}
        danger={muted || deafened}
        onClick={() => void voice.toggleMute()}
      />
      <IconButton
        icon={deafened ? 'headphonesOff' : 'headphones'}
        label={deafened ? 'Voltar a ouvir' : 'Ensurdecer'}
        danger={deafened}
        onClick={() => void voice.toggleDeafen()}
      />
      <IconButton icon="settings" label="Configurações" onClick={() => actions.openSettings()} />
    </div>
  );
}
