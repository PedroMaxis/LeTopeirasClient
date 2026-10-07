import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Channel, Message } from '@letopeiras/shared';
import { useStore } from '../../lib/store';
import type { PendingMessage } from '../../state/chat';
import { useSession } from '../../state/session';
import { Logo } from '../ui/Logo';
import { MessageItem, PendingItem } from './MessageItem';

/** Consecutive messages from the same author within this window share one header. */
const GROUP_WINDOW_MS = 7 * 60 * 1000;
const LOAD_MORE_THRESHOLD_PX = 300;
const BOTTOM_THRESHOLD_PX = 48;

const EMPTY: Message[] = [];

export function MessageList({ channel }: { channel: Channel }) {
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

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
    lastHeight.current = el.scrollHeight;
    if (el.scrollTop < LOAD_MORE_THRESHOLD_PX && entry?.hasMore && !entry.loading) {
      void chat.loadMessages(channel.id);
    }
    markReadIfVisible();
  };

  const firstUnread = messages.find((m) => m.id > readMarker && m.authorId !== me?.id)?.id;

  return (
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
  );
}
