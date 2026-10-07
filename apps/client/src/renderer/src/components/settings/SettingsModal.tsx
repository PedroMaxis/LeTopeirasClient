import { useEffect, useState } from 'react';
import { useStore } from '../../lib/store';
import { useSession } from '../../state/session';
import { Icon } from '../ui/Icon';
import { AccountSettings } from './AccountSettings';
import { AdminChannels } from './AdminChannels';
import { AdminInvites } from './AdminInvites';
import { AdminMembers } from './AdminMembers';
import { AdminRoles } from './AdminRoles';
import { NotificationSettings } from './NotificationSettings';
import { ProfileSettings } from './ProfileSettings';
import { StreamSettings } from './StreamSettings';
import { VoiceSettings } from './VoiceSettings';

export type SettingsPage =
  | 'account'
  | 'profile'
  | 'voice'
  | 'stream'
  | 'notifications'
  | 'channels'
  | 'roles'
  | 'members'
  | 'invites';

const ADMIN_PAGES: SettingsPage[] = ['channels', 'roles', 'members', 'invites'];

export function SettingsModal({
  initialPage,
  onClose,
}: {
  initialPage: SettingsPage;
  onClose(): void;
}) {
  const session = useSession();
  const me = useStore(session.chat.store, (s) => s.me);
  const [chosen, setPage] = useState<SettingsPage>(initialPage);
  // Losing admin while the modal is open falls back to a page everyone has.
  const page = ADMIN_PAGES.includes(chosen) && !me?.isAdmin ? 'voice' : chosen;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Dialogs inside the settings handle Escape themselves.
      if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const item = (id: SettingsPage, label: string) => (
    <button
      type="button"
      className={`settings-nav-item ${page === id ? 'active' : ''}`}
      onClick={() => setPage(id)}
    >
      {label}
    </button>
  );

  return (
    <div className="settings" role="dialog" aria-label="Configurações">
      <nav className="settings-nav">
        <div className="settings-nav-inner">
          <div className="settings-nav-section">USUÁRIO</div>
          {item('account', 'Minha conta')}
          {item('profile', 'Perfil')}
          <div className="settings-nav-section">APLICATIVO</div>
          {item('voice', 'Voz e áudio')}
          {item('stream', 'Transmissão')}
          {item('notifications', 'Notificações')}
          {me?.isAdmin && (
            <>
              <div className="settings-nav-section">ADMIN</div>
              {item('channels', 'Canais')}
              {item('roles', 'Tags')}
              {item('members', 'Membros')}
              {item('invites', 'Convites')}
            </>
          )}
          <div className="settings-nav-divider" />
          <button
            type="button"
            className="settings-nav-item logout"
            onClick={() => void session.logout()}
          >
            Sair
          </button>
        </div>
      </nav>
      <div className="settings-content">
        <div className="settings-page">
          {page === 'account' && <AccountSettings />}
          {page === 'profile' && <ProfileSettings />}
          {page === 'voice' && <VoiceSettings />}
          {page === 'stream' && <StreamSettings />}
          {page === 'notifications' && <NotificationSettings />}
          {page === 'channels' && <AdminChannels />}
          {page === 'roles' && <AdminRoles />}
          {page === 'members' && <AdminMembers />}
          {page === 'invites' && <AdminInvites />}
        </div>
        <div className="settings-close">
          <button type="button" aria-label="Fechar configurações" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
          <div>ESC</div>
        </div>
      </div>
    </div>
  );
}
