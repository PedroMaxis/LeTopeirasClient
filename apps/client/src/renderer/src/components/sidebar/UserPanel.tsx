import { settings, updateSettings } from '../../lib/settings';
import { useStore } from '../../lib/store';
import { useSession } from '../../state/session';
import type { LayoutActions } from '../MainLayout';
import { Avatar } from '../ui/Avatar';
import { useContextMenu } from '../ui/ContextMenu';
import { IconButton } from '../ui/controls';
import { Icon } from '../ui/Icon';

/** Bottom-left: who I am, plus mute / deafen / settings. */
export function UserPanel({ actions }: { actions: LayoutActions }) {
  const { chat, voice } = useSession();
  const me = useStore(chat.store, (s) => s.me);
  const muted = useStore(voice.store, (s) => s.muted);
  const deafened = useStore(voice.store, (s) => s.deafened);
  const doNotDisturb = useStore(settings, (s) => s.doNotDisturb);
  const menu = useContextMenu();

  return (
    <div className="user-panel">
      {menu.menu}
      <button
        type="button"
        className="user-panel-me"
        title={doNotDisturb ? 'Não perturbe: só você vê' : 'Alterar status'}
        onClick={(e) =>
          menu.open(e, [
            {
              label: 'Disponível',
              hint: doNotDisturb ? undefined : '✓',
              onSelect: () => updateSettings({ doNotDisturb: false }),
            },
            {
              label: 'Não perturbe',
              hint: doNotDisturb ? '✓' : 'Só neste PC',
              onSelect: () => updateSettings({ doNotDisturb: true }),
            },
          ])
        }
      >
        <span className="user-panel-avatar">
          <Avatar user={me ?? undefined} size={32} status="online" />
          {doNotDisturb && (
            <span className="dnd-moon">
              <Icon name="moon" size={10} />
            </span>
          )}
        </span>
        <span className="user-panel-names">
          <span className="user-panel-name">{me?.displayName}</span>
          <span className="user-panel-sub">
            {doNotDisturb ? 'Não perturbe' : `@${me?.username}`}
          </span>
        </span>
      </button>
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
