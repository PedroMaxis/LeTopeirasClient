import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Channel } from '@letopeiras/shared';
import { isUnread, matchScore, normalize, sidebarOrder } from '../lib/channels';
import { canAccess } from '../lib/roles';
import { useStore } from '../lib/store';
import { useSession } from '../state/session';
import { Icon } from './ui/Icon';

const MAX_RESULTS = 12;

/**
 * Ctrl+K: jump to a channel by typing part of its name. Empty, it lists unread channels
 * first. ↑/↓ choose, Enter opens (a voice channel is joined), Esc closes.
 */
export function QuickSwitcher(props: { onOpen(channel: Channel): void; onClose(): void }) {
  const { chat } = useSession();
  const channels = useStore(chat.store, (s) => s.channels);
  const categories = useStore(chat.store, (s) => s.categories);
  const me = useStore(chat.store, (s) => s.me);
  const readStates = useStore(chat.store, (s) => s.readStates);
  const mentions = useStore(chat.store, (s) => s.mentionCounts);
  const voice = useStore(chat.store, (s) => s.voice);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const q = normalize(query.trim().replace(/^#/, ''));
  const ordered = sidebarOrder(channels, categories).filter((c) => canAccess(me, c));
  const results = ordered
    .map((channel, order) => ({ channel, order, score: matchScore(normalize(channel.name), q) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => {
      if (q) return b.score - a.score || a.order - b.order;
      // Nothing typed: unread channels on top, otherwise the sidebar order.
      const unread = (c: Channel) => (isUnread(c, readStates) ? 1 : 0);
      return unread(b.channel) - unread(a.channel) || a.order - b.order;
    })
    .slice(0, MAX_RESULTS)
    .map((r) => r.channel);
  const selected = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    list.current?.querySelector('.switcher-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((selected + step + results.length) % Math.max(1, results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const channel = results[selected];
      if (channel) props.onOpen(channel);
    } else if (e.key === 'Escape') {
      props.onClose();
    }
  };

  const categoryName = (channel: Channel) =>
    categories.find((c) => c.id === channel.categoryId)?.name;

  return (
    <div className="modal-backdrop switcher-backdrop" onMouseDown={props.onClose}>
      <div
        className="modal switcher"
        role="dialog"
        aria-label="Trocar de canal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          className="input switcher-input"
          placeholder="Para onde você quer ir?"
          value={query}
          autoFocus
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="switcher-list" ref={list} role="listbox">
          {results.length === 0 && (
            <div className="switcher-empty">Nenhum canal com esse nome.</div>
          )}
          {results.map((channel, i) => {
            const count = mentions[channel.id] ?? 0;
            const people = voice[channel.id]?.length ?? 0;
            return (
              <button
                type="button"
                key={channel.id}
                role="option"
                aria-selected={i === selected}
                className={`switcher-item ${i === selected ? 'active' : ''} ${isUnread(channel, readStates) ? 'unread' : ''}`}
                onMouseMove={() => i !== selected && setActive(i)}
                onClick={() => props.onOpen(channel)}
              >
                <Icon name={channel.type === 'text' ? 'hash' : 'speaker'} size={18} />
                <span className="switcher-name">{channel.name}</span>
                {categoryName(channel) && (
                  <span className="switcher-category">{categoryName(channel)}</span>
                )}
                {channel.type === 'voice' && people > 0 && (
                  <span className="switcher-people">
                    {people} {people === 1 ? 'pessoa' : 'pessoas'}
                  </span>
                )}
                {count > 0 && <span className="mention-badge">{count > 99 ? '99+' : count}</span>}
              </button>
            );
          })}
        </div>
        <div className="switcher-hint">
          <kbd>↑</kbd> <kbd>↓</kbd> escolher · <kbd>Enter</kbd> abrir · <kbd>Esc</kbd> fechar ·{' '}
          <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> canal anterior/próximo
        </div>
      </div>
    </div>
  );
}
