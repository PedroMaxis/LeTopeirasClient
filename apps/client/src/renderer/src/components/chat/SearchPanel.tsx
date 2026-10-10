import { useCallback, useEffect, useState } from 'react';
import type { Message } from '@letopeiras/shared';
import { errorMessage } from '../../lib/api';
import { formatTimestamp } from '../../lib/format';
import { renderMarkdown } from '../../lib/markdown';
import { nameColor } from '../../lib/roles';
import { useStore } from '../../lib/store';
import { useSession } from '../../state/session';
import { Avatar } from '../ui/Avatar';
import { IconButton } from '../ui/controls';
import { Icon } from '../ui/Icon';

export interface SearchRequest {
  query: string;
  /** null: every channel you can see. */
  channelId: number | null;
}

interface Results {
  key: string;
  messages: Message[];
  hasMore: boolean;
  loading: boolean;
  error: string | null;
}

/**
 * Search results beside the chat (where the member list goes). Clicking one opens its
 * channel and scrolls to the message.
 */
export function SearchPanel(props: {
  request: SearchRequest;
  /** The channel on screen, for the "Este canal" scope. */
  channelId: number;
  onScope(channelId: number | null): void;
  onOpen(message: Message): void;
  onClose(): void;
}) {
  const { api, chat } = useSession();
  const users = useStore(chat.store, (s) => s.users);
  const roles = useStore(chat.store, (s) => s.roles);
  const channels = useStore(chat.store, (s) => s.channels);
  const { query, channelId } = props.request;
  const key = `${channelId ?? 'all'}:${query}`;
  const [results, setResults] = useState<Results | null>(null);

  /** One page of results for the current key; `before` is the next page after `shown`. */
  const fetchPage = useCallback(
    (before?: number) =>
      api.search({ q: query, channelId: channelId ?? undefined, before }).then(
        (page): ((shown: Results | null) => Results | null) =>
          (shown) =>
            before === undefined || shown?.key === key
              ? {
                  key,
                  messages: before ? [...(shown?.messages ?? []), ...page.messages] : page.messages,
                  hasMore: page.hasMore,
                  loading: false,
                  error: null,
                }
              : shown,
        (err: unknown) => () => ({
          key,
          messages: [],
          hasMore: false,
          loading: false,
          error: errorMessage(err),
        }),
      ),
    [api, query, channelId, key],
  );

  // A new query or scope starts over (the previous results stay until the new ones arrive).
  useEffect(() => {
    let cancelled = false;
    void fetchPage().then((update) => !cancelled && setResults(update));
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  const current = results?.key === key ? results : null;
  const channelName = (id: number) => channels.find((c) => c.id === id)?.name ?? '?';

  return (
    <aside className="search-panel">
      <header className="search-panel-header">
        <div className="search-panel-title">
          {current
            ? `${current.messages.length}${current.hasMore ? '+' : ''} ${current.messages.length === 1 ? 'resultado' : 'resultados'}`
            : 'Buscando…'}
        </div>
        <IconButton icon="close" label="Fechar busca" onClick={props.onClose} />
      </header>
      <div className="search-scope">
        <button
          type="button"
          className={channelId !== null ? 'active' : ''}
          onClick={() => props.onScope(props.channelId)}
        >
          Este canal
        </button>
        <button
          type="button"
          className={channelId === null ? 'active' : ''}
          onClick={() => props.onScope(null)}
        >
          Todos os canais
        </button>
      </div>
      <div className="search-results">
        {current?.error && <p className="form-error">{current.error}</p>}
        {current && !current.error && current.messages.length === 0 && (
          <div className="search-empty">
            <Icon name="search" size={32} />
            <p>Nada encontrado para “{query}”.</p>
          </div>
        )}
        {current?.messages.map((message) => {
          const author = users[message.authorId];
          return (
            <button
              type="button"
              key={message.id}
              className="search-result"
              onClick={() => props.onOpen(message)}
            >
              <div className="search-result-channel"># {channelName(message.channelId)}</div>
              <div className="search-result-row">
                <Avatar user={author} size={32} />
                <div className="search-result-body">
                  <div className="message-header">
                    <span className="message-author" style={{ color: nameColor(author, roles) }}>
                      {author?.displayName ?? 'Alguém'}
                    </span>
                    <span className="message-time">{formatTimestamp(message.createdAt)}</span>
                  </div>
                  <div className="message-content">{renderMarkdown(message.content)}</div>
                </div>
              </div>
            </button>
          );
        })}
        {current?.hasMore && (
          <button
            type="button"
            className="button secondary small search-more"
            disabled={current.loading}
            onClick={() => {
              setResults({ ...current, loading: true });
              void fetchPage(current.messages.at(-1)?.id).then(setResults);
            }}
          >
            {current.loading ? 'Carregando…' : 'Mais resultados'}
          </button>
        )}
      </div>
    </aside>
  );
}
