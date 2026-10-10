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
import { formatDay, sameDay } from '../../lib/format';
import { showToast } from '../../lib/toast';
import { useStore } from '../../lib/store';
import type { PendingMessage } from '../../state/chat';
import { useSession } from '../../state/session';
import { Icon } from '../ui/Icon';
import { Mole } from '../ui/Mole';
import { JUMP_TO_MESSAGE_EVENT, takePendingJump } from './events';
import { MessageItem, PendingItem } from './MessageItem';

/** Consecutive messages from the same author within this window share one header. */
const GROUP_WINDOW_MS = 7 * 60 * 1000;
const LOAD_MORE_THRESHOLD_PX = 300;
const BOTTOM_THRESHOLD_PX = 48;

const EMPTY: Message[] = [];
/** How far back a jump may load (pages of history) before giving up. */
const MAX_JUMP_PAGES = 30;
const JUMP_TIMEOUT_MS = 15_000;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

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

  // Previews and images load after the text: stay at the bottom if we were there.
  useEffect(() => {
    const inner = scroller.current?.firstElementChild;
    if (!inner) return;
    const observer = new ResizeObserver(() => {
      const el = scroller.current;
      if (el && atBottom.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  // Reply quotes and search results: scroll to a message, loading older pages if needed.
  useEffect(() => {
    let cancelled = false;
    const jump = async (messageId: number) => {
      const deadline = Date.now() + JUMP_TIMEOUT_MS;
      let pages = 0;
      while (!cancelled && Date.now() < deadline) {
        const el = scroller.current?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          el.classList.remove('flash');
          void el.offsetWidth; // restart the animation
          el.classList.add('flash');
          return;
        }
        const entry = chat.store.get().messages[channel.id];
        if (entry?.loading) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          continue;
        }
        const oldest = entry?.messages[0]?.id;
        // Already loaded back past it: it was deleted.
        if (entry && (!entry.hasMore || (oldest !== undefined && oldest < messageId))) break;
        if (pages++ >= MAX_JUMP_PAGES) break;
        await chat.loadMessages(channel.id);
        await nextFrame();
        await nextFrame();
      }
      if (!cancelled) showToast('Não achei essa mensagem; talvez tenha sido apagada.', 'info');
    };
    const onJump = () => {
      const target = takePendingJump(channel.id);
      if (target) void jump(target.messageId);
    };
    // A search result in another channel: the jump was asked before this list existed.
    onJump();
    window.addEventListener(JUMP_TO_MESSAGE_EVENT, onJump);
    return () => {
      cancelled = true;
      window.removeEventListener(JUMP_TO_MESSAGE_EVENT, onJump);
    };
  }, [chat, channel.id]);

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
              <Mole size={64} mode="peek" />
              <h2>Bem-vindo a #{channel.name}!</h2>
              <p>Esse é o começo do canal.</p>
            </div>
          )}
          {entry?.loading && <div className="messages-loading">Carregando…</div>}
          {messages.map((message, i) => {
            const prev = messages[i - 1];
            const isNew = message.id === firstUnread;
            // The first loaded message only starts a day if it's the start of the channel.
            const newDay = prev ? !sameDay(prev.createdAt, message.createdAt) : !entry?.hasMore;
            const grouped =
              !isNew &&
              !newDay &&
              message.replyToId === null &&
              prev !== undefined &&
              prev.authorId === message.authorId &&
              message.createdAt - prev.createdAt < GROUP_WINDOW_MS;
            return (
              <div key={message.id}>
                {newDay && (
                  <div className="day-divider">
                    <span />
                    {formatDay(message.createdAt)}
                    <span />
                  </div>
                )}
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
