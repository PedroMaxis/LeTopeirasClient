import { useRef } from 'react';
import type { Channel } from '@letopeiras/shared';
import { canAccess } from '../../lib/roles';
import { useStore } from '../../lib/store';
import { useSession } from '../../state/session';
import { IconButton } from '../ui/controls';
import { Composer } from './Composer';
import { MessageList, type MessageListHandle } from './MessageList';

/** A text channel beside the voice stage, to chat while watching a share. */
export function ChatPanel(props: {
  channel: Channel;
  onSelect(channelId: number): void;
  onClose(): void;
}) {
  const { chat } = useSession();
  const channels = useStore(chat.store, (s) => s.channels);
  const me = useStore(chat.store, (s) => s.me);
  const list = useRef<MessageListHandle>(null);
  const textChannels = channels.filter((c) => c.type === 'text' && canAccess(me, c));

  return (
    <aside className="chat-panel">
      <header className="chat-panel-header">
        <select
          className="select"
          aria-label="Canal de texto"
          value={props.channel.id}
          onChange={(e) => props.onSelect(Number(e.target.value))}
        >
          {textChannels.map((c) => (
            <option key={c.id} value={c.id}>
              # {c.name}
            </option>
          ))}
        </select>
        <IconButton icon="close" label="Fechar chat" onClick={props.onClose} />
      </header>
      {/* Keyed so scroll position, the "NOVAS" marker and the draft follow the channel. */}
      <MessageList key={props.channel.id} ref={list} channel={props.channel} />
      <Composer
        key={`composer-${props.channel.id}`}
        channel={props.channel}
        onEscape={() => list.current?.jumpToBottom()}
      />
    </aside>
  );
}
