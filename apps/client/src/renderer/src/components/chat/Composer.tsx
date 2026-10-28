import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { LIMITS, type Channel } from '@letopeiras/shared';
import { useStore } from '../../lib/store';
import { useSession } from '../../state/session';
import { IconButton } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { INSERT_MENTION_EVENT } from '../MemberCard';
import { showToast } from '../../lib/toast';
import { AttachmentTray, useAttachmentTray } from './AttachmentTray';
import { EmojiPicker } from './EmojiPicker';
import { editingMessage, replyingTo } from './MessageItem';
import { useTextAutocomplete } from './EmojiSuggestions';

/** Window event with `File[]` in `detail` (dropped on the chat): goes into the open composer. */
export const ATTACH_FILES_EVENT = 'letopeiras:attach-files';

export function Composer({ channel, onEscape }: { channel: Channel; onEscape(): void }) {
  const { chat } = useSession();
  const [value, setText] = useState(() => chat.getDraft(channel.id));
  const [emojiOpen, setEmojiOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const tray = useAttachmentTray();
  // Mounted per channel (keyed in ChatView), so the draft is what survives switching.
  const setValue = (next: string) => {
    setText(next);
    chat.setDraft(channel.id, next);
  };

  // A restored draft resumes typing at its end.
  useEffect(() => {
    const el = input.current;
    el?.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const mentions = useTextAutocomplete({ channel, value, setValue, input });

  /** Inserts at the cursor and keeps typing focus. */
  const insertEmoji = (emoji: string) => {
    const el = input.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = (value.slice(0, start) + emoji + value.slice(end)).slice(0, LIMITS.messageMax);
    setValue(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  // "Marcar" in a member card types the mention here.
  useEffect(() => {
    const onInsert = (event: Event) => {
      const el = input.current;
      const at = el?.selectionStart ?? value.length;
      const before = value.slice(0, at);
      const space = before && !/\s$/.test(before) ? ' ' : '';
      insertEmoji(`${space}@${(event as CustomEvent<string>).detail} `);
    };
    window.addEventListener(INSERT_MENTION_EVENT, onInsert);
    return () => window.removeEventListener(INSERT_MENTION_EVENT, onInsert);
  });

  const reply = useStore(replyingTo, (s) => (s.target?.channelId === channel.id ? s.target : null));
  const replyAuthor = useStore(chat.store, (s) => (reply ? s.users[reply.authorId] : undefined));
  const cancelReply = () => replyingTo.set({ target: null });
  // Picking "Responder" puts the cursor here.
  useEffect(() => {
    if (reply) input.current?.focus();
  }, [reply]);

  // Files dropped on the chat (ChatView) go to the tray like pasted or picked ones.
  useEffect(() => {
    const onFiles = (event: Event) => tray.add((event as CustomEvent<File[]>).detail);
    window.addEventListener(ATTACH_FILES_EVENT, onFiles);
    return () => window.removeEventListener(ATTACH_FILES_EVENT, onFiles);
  });

  const send = () => {
    const content = value.trim();
    if (!content && tray.items.length === 0) return;
    if (tray.uploading) {
      showToast('Espere as imagens terminarem de enviar.');
      return;
    }
    if (tray.failed) {
      showToast('Remova as imagens que falharam antes de enviar.');
      return;
    }
    chat.sendMessage(
      channel.id,
      content,
      reply ? { replyToId: reply.messageId, replyPing: reply.ping } : undefined,
      tray.take(),
    );
    if (reply) cancelReply();
    setValue('');
    mentions.reset();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentions.onKeyDown(e)) return;
    // Shift+Esc (mark everything as read) is handled by the layout.
    if (e.key === 'Escape' && !emojiOpen && !e.shiftKey) {
      // Esc first drops the reply, then goes to the newest messages and marks the channel read.
      if (reply) cancelReply();
      else {
        onEscape();
        chat.markRead(channel.id);
      }
    }
    // ↑ in an empty box edits your last message with text, like in Discord.
    if (e.key === 'ArrowUp' && !value && !e.altKey && !e.ctrlKey && !e.shiftKey) {
      const { me, messages } = chat.store.get();
      const last = messages[channel.id]?.messages.findLast(
        (m) => m.authorId === me?.id && m.content !== '',
      );
      if (last) {
        e.preventDefault();
        editingMessage.set({ id: last.id });
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="composer">
      {reply && (
        <div className="reply-bar">
          <span>
            Respondendo a <b>{replyAuthor?.displayName ?? 'Alguém'}</b>
          </span>
          <button
            type="button"
            className={`reply-ping ${reply.ping ? 'on' : ''}`}
            title={
              reply.ping
                ? 'A pessoa vai ser marcada. Clique para não marcar.'
                : 'A pessoa não vai ser marcada. Clique para marcar.'
            }
            onClick={() => replyingTo.set({ target: { ...reply, ping: !reply.ping } })}
          >
            @ {reply.ping ? 'LIGADO' : 'DESLIGADO'}
          </button>
          <IconButton icon="close" size={16} label="Cancelar resposta" onClick={cancelReply} />
        </div>
      )}
      <AttachmentTray tray={tray} />
      <div className={`composer-box ${reply ? 'replying' : ''}`}>
        <label className="composer-attach" title="Enviar imagem" aria-label="Enviar imagem">
          <Icon name="plus" size={20} />
          <input
            type="file"
            multiple
            hidden
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => {
              tray.add([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
        </label>
        <textarea
          ref={input}
          className="composer-input"
          aria-label="Mensagem"
          placeholder={`Conversar em #${channel.name}`}
          value={value}
          autoFocus
          maxLength={LIMITS.messageMax}
          rows={Math.min(10, value.split('\n').length)}
          onChange={(e) => {
            setValue(e.target.value);
            mentions.trackCursor(e.target);
            if (e.target.value.trim()) chat.startTyping(channel.id);
          }}
          onSelect={(e) => mentions.trackCursor(e.currentTarget)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length > 0) {
              e.preventDefault();
              tray.add(files);
            }
          }}
        />
        {mentions.popover}
        <IconButton
          icon="smile"
          size={22}
          label="Emojis"
          className="composer-emoji"
          active={emojiOpen}
          onClick={() => setEmojiOpen((open) => !open)}
        />
        {emojiOpen && <EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />}
      </div>
      <TypingIndicator channelId={channel.id} />
    </div>
  );
}

function TypingIndicator({ channelId }: { channelId: number }) {
  const { chat } = useSession();
  const typing = useStore(chat.store, (s) => s.typing[channelId]);
  const users = useStore(chat.store, (s) => s.users);
  const meId = useStore(chat.store, (s) => s.me?.id);

  const names = Object.keys(typing ?? {})
    .map(Number)
    .filter((id) => id !== meId)
    .map((id) => users[id]?.displayName ?? 'Alguém');

  let text: ReactNode = null;
  if (names.length === 1) {
    text = (
      <>
        <b>{names[0]}</b> está digitando…
      </>
    );
  } else if (names.length === 2) {
    text = (
      <>
        <b>{names[0]}</b> e <b>{names[1]}</b> estão digitando…
      </>
    );
  } else if (names.length > 2) {
    text = 'Várias pessoas estão digitando…';
  }

  return (
    <div className="typing">
      <span>{text}</span>
    </div>
  );
}
