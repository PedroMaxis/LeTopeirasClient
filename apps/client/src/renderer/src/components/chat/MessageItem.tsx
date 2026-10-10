import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { EVERYONE_MENTION, LIMITS, type Channel, type Message } from '@letopeiras/shared';
import { nameColor } from '../../lib/roles';
import { formatFull, formatTime, formatTimestamp } from '../../lib/format';
import { hideSpoilers, renderMarkdown } from '../../lib/markdown';
import { Store, useStore } from '../../lib/store';
import type { PendingMessage } from '../../state/chat';
import { useSession } from '../../state/session';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useMemberCard } from '../MemberCard';
import { Avatar } from '../ui/Avatar';
import { IconButton } from '../ui/controls';
import { Embeds } from './Embeds';
import { EmojiPicker } from './EmojiPicker';
import { useMentionAutocomplete } from './MentionSuggestions';
import { jumpToMessage } from './events';

/** The message being edited, if any; one at a time, opened from the item or with ↑. */
export const editingMessage = new Store<{ id: number | null }>({ id: null });

/** The message the composer is answering ("Respondendo a…"); `ping` mentions its author. */
export const replyingTo = new Store<{
  target: { channelId: number; messageId: number; authorId: number; ping: boolean } | null;
}>({ target: null });

/** One line of plain text from a message, for reply quotes (spoilers stay hidden). */
export const snippetOf = (content: string) =>
  hideSpoilers(content)
    .replace(/[*_~`|>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

interface Props {
  message: Message;
  /** Same author as the previous message: no avatar or name. */
  grouped: boolean;
}

export function MessageItem({ message, grouped }: Props) {
  const { chat } = useSession();
  const author = useStore(chat.store, (s) => s.users[message.authorId]);
  const roles = useStore(chat.store, (s) => s.roles);
  const me = useStore(chat.store, (s) => s.me);
  const users = useStore(chat.store, (s) => s.users);
  const channel = useStore(chat.store, (s) => s.channels.find((c) => c.id === message.channelId));
  const editing = useStore(editingMessage, (s) => s.id === message.id);
  const setEditing = (on: boolean) => editingMessage.set({ id: on ? message.id : null });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [picker, setPicker] = useState<CSSProperties | null>(null);
  const card = useMemberCard();

  const mine = message.authorId === me?.id;
  const mentionsMe =
    me !== null && (message.mentionIds.includes(me.id) || (message.mentionsEveryone && !mine));

  const renderMention = (username: string, key: string) => {
    if (username === EVERYONE_MENTION) {
      return (
        <span key={key} className="mention me" title="Avisou todo mundo que vê o canal">
          @{EVERYONE_MENTION}
        </span>
      );
    }
    const user = Object.values(users).find((u) => u.username === username);
    if (!user) return null;
    return (
      <span
        key={key}
        className={`mention ${user.id === me?.id ? 'me' : ''}`}
        title={`@${username}`}
      >
        @{user.displayName}
      </span>
    );
  };
  const canDelete = mine || me?.isAdmin === true;

  return (
    <div
      className={`message ${grouped ? 'grouped' : ''} ${editing ? 'editing' : ''} ${mentionsMe ? 'mentioned' : ''} ${picker ? 'picking' : ''}`}
      data-message-id={message.id}
    >
      {grouped ? (
        <span className="message-gutter-time" title={formatFull(message.createdAt)}>
          {formatTime(message.createdAt)}
        </span>
      ) : (
        <button type="button" className="message-avatar" onClick={card.open(message.authorId)}>
          <Avatar user={author} size={40} />
        </button>
      )}
      {card.card}
      <div className="message-body">
        {message.replyToId !== null && <ReplyQuote message={message} />}
        {!grouped && (
          <div className="message-header">
            <button
              type="button"
              className="message-author"
              style={{ color: nameColor(author, roles) }}
              onClick={card.open(message.authorId)}
            >
              {author?.displayName ?? 'Alguém'}
            </button>
            <span className="message-time" title={formatFull(message.createdAt)}>
              {formatTimestamp(message.createdAt)}
            </span>
          </div>
        )}
        {editing && channel ? (
          <EditBox
            channel={channel}
            initial={message.content}
            onCancel={() => setEditing(false)}
            onSave={(content) => {
              if (content !== message.content) chat.editMessage(message.id, content);
              setEditing(false);
            }}
          />
        ) : (
          <div className="message-content">
            {renderMarkdown(message.content, renderMention)}
            {message.editedAt !== null && (
              <span className="message-edited" title={formatFull(message.editedAt)}>
                {' '}
                (editado)
              </span>
            )}
          </div>
        )}
        {!editing && message.embeds.length > 0 && <Embeds embeds={message.embeds} />}
        {message.reactions.length > 0 && <Reactions message={message} />}
      </div>
      {!editing && (
        <div className="message-actions">
          <IconButton
            icon="smilePlus"
            size={16}
            label="Reagir"
            onClick={(e) => setPicker(pickerPosition(e.currentTarget))}
          />
          <IconButton
            icon="reply"
            size={16}
            label="Responder"
            onClick={() =>
              replyingTo.set({
                target: {
                  channelId: message.channelId,
                  messageId: message.id,
                  authorId: message.authorId,
                  ping: !mine,
                },
              })
            }
          />
          {mine && (
            <IconButton icon="pencil" size={16} label="Editar" onClick={() => setEditing(true)} />
          )}
          {canDelete && (
            <IconButton
              icon="trash"
              size={16}
              label="Apagar (Shift+clique apaga sem perguntar)"
              danger
              onClick={(e) => {
                if (e.shiftKey) chat.deleteMessage(message.id);
                else setConfirmDelete(true);
              }}
            />
          )}
        </div>
      )}
      {picker && (
        <EmojiPicker
          style={picker}
          onPick={(emoji) => {
            chat.toggleReaction(message.channelId, message.id, emoji);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Apagar mensagem"
          confirmLabel="Apagar"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            chat.deleteMessage(message.id);
          }}
        >
          <p>Tem certeza? Isso não dá para desfazer.</p>
          <blockquote className="confirm-quote">{message.content}</blockquote>
        </ConfirmDialog>
      )}
    </div>
  );
}

const PICKER_WIDTH = 340;
const PICKER_HEIGHT = 320;

/** Where the reaction picker goes: above the button if it fits, else below; inside the window. */
function pickerPosition(button: HTMLElement): CSSProperties {
  const r = button.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.right - PICKER_WIDTH, window.innerWidth - PICKER_WIDTH - 8));
  const top = r.top - PICKER_HEIGHT - 8 > 38 ? r.top - PICKER_HEIGHT - 8 : r.bottom + 8;
  return { position: 'fixed', left, top, right: 'auto', bottom: 'auto' };
}

/** "Fulano: trecho" above a reply; clicking it scrolls to the original. */
function ReplyQuote({ message }: { message: Message }) {
  const { chat } = useSession();
  const roles = useStore(chat.store, (s) => s.roles);
  const original = message.replyTo;
  const author = useStore(chat.store, (s) => (original ? s.users[original.authorId] : undefined));
  if (!original) {
    return <div className="message-reply deleted">Mensagem original apagada</div>;
  }
  return (
    <button
      type="button"
      className="message-reply"
      title="Ir para a mensagem"
      onClick={() =>
        message.replyToId !== null &&
        jumpToMessage({ channelId: message.channelId, messageId: message.replyToId })
      }
    >
      <Avatar user={author} size={16} />
      <span className="message-reply-author" style={{ color: nameColor(author, roles) }}>
        {author?.displayName ?? 'Alguém'}
      </span>
      <span className="message-reply-text">{snippetOf(original.content)}</span>
    </button>
  );
}

/** Emoji chips under a message; ours are highlighted and clicking toggles. */
function Reactions({ message }: { message: Message }) {
  const { chat } = useSession();
  const meId = useStore(chat.store, (s) => s.me?.id);
  const users = useStore(chat.store, (s) => s.users);
  return (
    <div className="reactions">
      {message.reactions.map((reaction) => {
        const mine = meId !== undefined && reaction.userIds.includes(meId);
        const names = reaction.userIds.map((id) => users[id]?.displayName ?? 'Alguém');
        return (
          <button
            type="button"
            key={reaction.emoji}
            className={`reaction ${mine ? 'mine' : ''}`}
            title={`${names.join(', ')} reagiu com ${reaction.emoji}`}
            onClick={() => chat.toggleReaction(message.channelId, message.id, reaction.emoji)}
          >
            <span className="reaction-emoji">{reaction.emoji}</span>
            <span className="reaction-count">{reaction.userIds.length}</span>
          </button>
        );
      })}
    </div>
  );
}

function EditBox(props: {
  channel: Channel;
  initial: string;
  onSave(content: string): void;
  onCancel(): void;
}) {
  const [value, setValue] = useState(props.initial);
  const input = useRef<HTMLTextAreaElement>(null);
  const mentions = useMentionAutocomplete({ channel: props.channel, value, setValue, input });
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // An open suggestion list gets Enter/Esc first, like in the message box.
    if (mentions.onKeyDown(e)) return;
    if (e.key === 'Escape') props.onCancel();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const content = value.trim();
      if (content) props.onSave(content);
    }
  };
  return (
    <div className="edit-box">
      <textarea
        ref={input}
        className="composer-input"
        value={value}
        autoFocus
        maxLength={LIMITS.messageMax}
        rows={Math.min(8, value.split('\n').length)}
        onChange={(e) => {
          setValue(e.target.value);
          mentions.trackCursor(e.target);
        }}
        onSelect={(e) => mentions.trackCursor(e.currentTarget)}
        onKeyDown={onKeyDown}
        onFocus={(e) => e.currentTarget.setSelectionRange(value.length, value.length)}
      />
      {mentions.popover}
      <div className="edit-hint">Esc para cancelar · Enter para salvar</div>
    </div>
  );
}

export function PendingItem({ pending }: { pending: PendingMessage }) {
  const { chat } = useSession();
  const me = useStore(chat.store, (s) => s.me);
  return (
    <div className={`message pending ${pending.failed ? 'failed' : ''}`}>
      <Avatar user={me ?? undefined} size={40} />
      <div className="message-body">
        <div className="message-header">
          <span className="message-author">{me?.displayName}</span>
          <span className="message-time">{formatTimestamp(pending.createdAt)}</span>
        </div>
        <div className="message-content">{pending.content}</div>
        {pending.failed && (
          <div className="message-failed">
            Não enviada.{' '}
            <button type="button" className="link" onClick={() => chat.retryMessage(pending.nonce)}>
              Tentar de novo
            </button>{' '}
            ·{' '}
            <button
              type="button"
              className="link"
              onClick={() => chat.discardMessage(pending.nonce)}
            >
              Descartar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
