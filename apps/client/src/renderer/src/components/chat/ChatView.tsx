import type { Channel } from '@letopeiras/shared';
import { settings, updateSettings } from '../../lib/settings';
import { useStore } from '../../lib/store';
import { IconButton } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { Composer } from './Composer';
import { MessageList } from './MessageList';

export function ChatView({ channel }: { channel: Channel }) {
  const showMembers = useStore(settings, (s) => s.showMembers);
  return (
    <section className="chat">
      <header className="main-header">
        <Icon name="hash" size={22} />
        <span className="main-header-title">{channel.name}</span>
        {channel.topic && (
          <>
            <span className="main-header-divider" />
            <span className="main-header-topic" title={channel.topic}>
              {channel.topic}
            </span>
          </>
        )}
        <div className="main-header-actions">
          <IconButton
            icon="members"
            size={22}
            label={showMembers ? 'Esconder membros' : 'Mostrar membros'}
            active={showMembers}
            onClick={() => updateSettings({ showMembers: !showMembers })}
          />
        </div>
      </header>
      {/* Keyed so scroll position and the "NOVAS" marker reset per channel. */}
      <MessageList key={channel.id} channel={channel} />
      <Composer key={`composer-${channel.id}`} channel={channel} />
    </section>
  );
}
