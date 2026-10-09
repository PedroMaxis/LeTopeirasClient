import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from 'react';
import type { Channel, Message } from '@letopeiras/shared';
import { useStore } from '../../lib/store';
import type { PendingMessage } from '../../state/chat';
import { useSession } from '../../state/session';
import { Icon } from '../ui/Icon';
import { Logo } from '../ui/Logo';
import { MessageItem, PendingItem } from './MessageItem';

/** Consecutive messages from the same author within this window share one header. */
const GROUP_WINDOW_MS = 7 * 60 * 1000;
const LOAD_MORE_THRESHOLD_PX = 300;
const BOTTOM_THRESHOLD_PX = 48;

const EMPTY: Message[] = [];

export interface MessageListHandle {
  jumpToBottom(): void;
}

export function MessageList({ channel, ref }: { channel: Channel; ref?: Ref<MessageListHandle> }) {
  const { chat } = useSession();
  const entry = useStore(chat.store, (s) => s.messages[channel.id]);
  const pendingAll = useStore(chat.store, (s) => s.pending);
  const me = useStore(chat.store, (s) => s.me);
  // Where "NOVAS" goes: the read position when the channel was opened, if it had unread
  // messages then. Messages arriving while we watch don't get the divider.
  const [readMarker] = useState(() => {
    const read = chat.store.get().readStates[channel.id] ?? 0;
    return (channel.lastMessageId ?? 0) > read ? read : Number.POSITIVE_INFINITY;
  });

  const messages = entry?.messages ?? EMPTY;
  const pending = pendingAll.filter((p: PendingMessage) => p.channelId === channel.id);

  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastHeight = useRef(0);
  const firstId = useRef<number | undefined>(undefined);
  const pendingCount = useRef(pending.length);
  // Scrolled up: the newest message id when we left the bottom, and whether we're more
  // than a screen away. They drive the "Ir para o fim" bar.
  const [awayFrom, setAwayFrom] = useState<number | null>(null);
  const [far, setFar] = useState(false);

  useEffect(() => {
    if (!entry) void chat.loadMessages(channel.id);
  }, [chat, channel.id, entry]);

  const markReadIfVisible = useCallback(() => {
    if (atBottom.current && document.hasFocus()) chat.markRead(channel.id);
  }, [chat, channel.id]);

  // New messages keep us pinned to the bottom; older pages keep the visible message in place.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const prependedOlder = firstId.current !== undefined && messages[0]?.id !== firstId.current;
    // Sending something brings us back to the bottom, like in Discord.
    if (pending.length > pendingCount.current) atBottom.current = true;
    pendingCount.current = pending.length;
    if (prependedOlder && !atBottom.current) {
      el.scrollTop += el.scrollHeight - lastHeight.current;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    firstId.current = messages[0]?.id;
    lastHeight.current = el.scrollHeight;

    // A short first page may not fill the screen, so no scroll event would load more.
    if (entry?.hasMore && !entry.loading && el.scrollHeight <= el.clientHeight) {
      void chat.loadMessages(channel.id);
    }
  }, [messages, pending.length, entry, chat, channel.id]);

  useEffect(() => {
    markReadIfVisible();
  }, [messages, markReadIfVisible]);

  useEffect(() => {
    window.addEventListener('focus', markReadIfVisible);
    return () => window.removeEventListener('focus', markReadIfVisible);
  }, [markReadIfVisible]);

  const jumpToBottom = useCallback(() => {
    const el = scroller.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);
  useImperativeHandle(ref, () => ({ jumpToBottom }), [jumpToBottom]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = distance < BOTTOM_THRESHOLD_PX;
    lastHeight.current = el.scrollHeight;
    if (atBottom.current) setAwayFrom(null);
    else if (awayFrom === null) setAwayFrom(messages.at(-1)?.id ?? 0);
    setFar(distance > el.clientHeight);
    if (el.scrollTop < LOAD_MORE_THRESHOLD_PX && entry?.hasMore && !entry.loading) {
      void chat.loadMessages(channel.id);
    }
    markReadIfVisible();
  };

  const firstUnread = messages.find((m) => m.id > readMarker && m.authorId !== me?.id)?.id;
  const newCount =
    awayFrom === null ? 0 : messages.filter((m) => m.id > awayFrom && m.authorId !== me?.id).length;

  return (
    <div className="messages-wrap">
      <div className="messages" ref={scroller} onScroll={onScroll}>
        <div className="messages-inner">
          {entry && !entry.hasMore && (
            <div className="channel-start">
              <Logo size={56} />
              <h2>Bem-vindo a #{channel.name}!</h2>
              <p>Esse é o começo do canal.</p>
            </div>
          )}
          {entry?.loading && <div className="messages-loading">Carregando…</div>}
          {messages.map((message, i) => {
            const prev = messages[i - 1];
            const isNew = message.id === firstUnread;
            const grouped =
              !isNew &&
              prev !== undefined &&
              prev.authorId === message.authorId &&
              message.createdAt - prev.createdAt < GROUP_WINDOW_MS;
            return (
              <div key={message.id}>
                {isNew && (
                  <div className="new-divider">
                    <span />
                    NOVAS
                  </div>
                )}
                <MessageItem message={message} grouped={grouped} />
              </div>
            );
          })}
          {pending.map((p) => (
            <PendingItem key={p.nonce} pending={p} />
          ))}
        </div>
      </div>
      {awayFrom !== null && (newCount > 0 || far) && (
        <button
          type="button"
          className={`jump-bar ${newCount > 0 ? 'has-new' : ''}`}
          onClick={jumpToBottom}
        >
          {newCount > 0 && (
            <span>
              {newCount} {newCount === 1 ? 'mensagem nova' : 'mensagens novas'}
            </span>
          )}
          <span className="jump-bar-action">
            Ir para o fim
            <Icon name="arrowDown" size={16} />
          </span>
        </button>
      )}
    </div>
  );
}
