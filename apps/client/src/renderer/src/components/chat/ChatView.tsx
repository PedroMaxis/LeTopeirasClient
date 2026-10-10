import { useEffect, useRef, useState } from 'react';
import type { Channel } from '@letopeiras/shared';
import { settings, updateSettings } from '../../lib/settings';
import { useStore } from '../../lib/store';
import { IconButton } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { Composer } from './Composer';
import { MessageList, type MessageListHandle } from './MessageList';

export function ChatView({
  channel,
  onSearch,
}: {
  channel: Channel;
  /** Enter in the search box. */
  onSearch(query: string): void;
}) {
  const showMembers = useStore(settings, (s) => s.showMembers);
  const list = useRef<MessageListHandle>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');

  // Ctrl+F jumps to the search box.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.code === 'KeyF') {
        e.preventDefault();
        searchBox.current?.focus();
        searchBox.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
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
          <label className="header-search">
            <input
              ref={searchBox}
              placeholder="Buscar"
              aria-label="Buscar mensagens"
              value={query}
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && query.trim()) onSearch(query.trim());
                if (e.key === 'Escape') e.currentTarget.blur();
              }}
            />
            <Icon name="search" size={16} />
          </label>
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
      <MessageList key={channel.id} ref={list} channel={channel} />
      <Composer
        key={`composer-${channel.id}`}
        channel={channel}
        onEscape={() => list.current?.jumpToBottom()}
      />
    </section>
  );
}
