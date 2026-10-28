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
import { summarizeUnread } from '../../lib/channels';
import { formatDay, formatTime, sameDay } from '../../lib/format';
import { anchorAt, scrollDeltaToAnchor } from '../../lib/scroll';
import { showToast } from '../../lib/toast';
import { useStore } from '../../lib/store';
import type { PendingMessage } from '../../state/chat';
import { useSession } from '../../state/session';
import { Icon } from '../ui/Icon';
import { Mole } from '../ui/Mole';
import { hasPendingJump, JUMP_TO_MESSAGE_EVENT, takePendingJump } from './events';
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
  // The "NOVAS" divider has scrolled above the screen, and the unread bar was dismissed.
  const [dividerAbove, setDividerAbove] = useState(false);
  const [unreadDismissed, setUnreadDismissed] = useState(false);

  useEffect(() => {
    if (!entry) void chat.loadMessages(channel.id);
  }, [chat, channel.id, entry]);

  const markReadIfVisible = useCallback(() => {
    if (atBottom.current && document.hasFocus()) chat.markRead(channel.id);
  }, [chat, channel.id]);

  const measureDivider = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const divider = el.querySelector('.new-divider');
    setDividerAbove(
      divider !== null && divider.getBoundingClientRect().bottom < el.getBoundingClientRect().top,
    );
  }, []);

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
      measureDivider();
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [measureDivider]);

  // Remember where we were scrolled to (not when at the end), to come back to it.
  const frame = useRef(0);
  // Recording waits until we know whether there is a position to restore (else the scroll to
  // the end on mount would erase it).
  const restoring = useRef(true);
  const recordAnchor = useCallback(() => {
    if (frame.current || restoring.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const el = scroller.current;
      if (!el || restoring.current) return;
      if (atBottom.current) return chat.setScrollAnchor(channel.id, null);
      const items = [...el.querySelectorAll<HTMLElement>('[data-message-id]')].map((node) => {
        const box = node.getBoundingClientRect();
        return { id: Number(node.dataset['messageId']), top: box.top, bottom: box.bottom };
      });
      chat.setScrollAnchor(channel.id, anchorAt(items, el.getBoundingClientRect().top));
    });
  }, [chat, channel.id]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // Coming back to a channel: restore that position once its messages are there, loading older
  // pages if it was far up. A deleted message (or no saved spot) leaves us at the end.
  const loaded = entry !== undefined;
  useEffect(() => {
    const anchor = chat.getScrollAnchor(channel.id);
    if (!loaded) return;
    if (!anchor || hasPendingJump(channel.id)) {
      restoring.current = false;
      return;
    }
    let cancelled = false;
    atBottom.current = false;
    void (async () => {
      const deadline = Date.now() + JUMP_TIMEOUT_MS;
      for (let pages = 0; !cancelled && Date.now() < deadline;) {
        const el = scroller.current?.querySelector<HTMLElement>(
          `[data-message-id="${anchor.messageId}"]`,
        );
        const box = scroller.current;
        if (el && box) {
          box.scrollTop += scrollDeltaToAnchor(
            el.getBoundingClientRect().top,
            box.getBoundingClientRect().top,
            anchor,
          );
          lastHeight.current = box.scrollHeight;
          restoring.current = false;
          return;
        }
        const current = chat.store.get().messages[channel.id];
        if (current?.loading) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          continue;
        }
        const oldest = current?.messages[0]?.id;
        if (!current || !current.hasMore || (oldest !== undefined && oldest < anchor.messageId))
          break;
        if (pages++ >= MAX_JUMP_PAGES) break;
        await chat.loadMessages(channel.id);
        await nextFrame();
        await nextFrame();
      }
      if (cancelled) return;
      // Not found: back to the end, as if there was nothing saved.
      chat.setScrollAnchor(channel.id, null);
      atBottom.current = true;
      const box = scroller.current;
      if (box) box.scrollTop = box.scrollHeight;
      restoring.current = false;
    })();
    return () => {
      cancelled = true;
      restoring.current = false;
    };
  }, [chat, channel.id, loaded]);

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

  // The unread bar's text: load older pages until the divider exists, then scroll to it.
  const goToUnread = async () => {
    const deadline = Date.now() + JUMP_TIMEOUT_MS;
    for (let pages = 0; Date.now() < deadline;) {
      const current = chat.store.get().messages[channel.id];
      if (!current || !current.hasMore || (current.messages[0]?.id ?? 0) <= readMarker) break;
      if (current.loading) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      if (pages++ >= MAX_JUMP_PAGES) break;
      await chat.loadMessages(channel.id);
      await nextFrame();
      await nextFrame();
    }
    scroller.current
      ?.querySelector('.new-divider')
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const markAsRead = () => {
    chat.markRead(channel.id);
    setUnreadDismissed(true);
  };

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = distance < BOTTOM_THRESHOLD_PX;
    lastHeight.current = el.scrollHeight;
    if (atBottom.current) setAwayFrom(null);
    else if (awayFrom === null) setAwayFrom(messages.at(-1)?.id ?? 0);
    setFar(distance > el.clientHeight);
    measureDivider();
    recordAnchor();
    if (el.scrollTop < LOAD_MORE_THRESHOLD_PX && entry?.hasMore && !entry.loading) {
      void chat.loadMessages(channel.id);
    }
    markReadIfVisible();
  };

  const firstUnread = messages.find((m) => m.id > readMarker && m.authorId !== me?.id)?.id;
  const unread = summarizeUnread(messages, entry?.hasMore ?? true, readMarker, me?.id);
  const showUnreadBar =
    entry !== undefined && !unreadDismissed && unread.count > 0 && (unread.more || dividerAbove);
  const newCount =
    awayFrom === null ? 0 : messages.filter((m) => m.id > awayFrom && m.authorId !== me?.id).length;

  return (
    <div className="messages-wrap">
      {showUnreadBar && (
        <div className="unread-bar">
          <button type="button" className="unread-bar-text" onClick={() => void goToUnread()}>
            {unread.first
              ? `${unread.count} ${unread.count === 1 ? 'mensagem nova' : 'mensagens novas'} desde ${formatTime(unread.first.createdAt)}`
              : `Mais de ${unread.count} mensagens novas`}
          </button>
          <button type="button" className="unread-bar-read" onClick={markAsRead}>
            Marcar como lido
          </button>
        </div>
      )}
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
