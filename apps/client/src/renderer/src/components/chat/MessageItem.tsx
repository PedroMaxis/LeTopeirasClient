import { useRef, useState, type KeyboardEvent } from 'react';
import { EVERYONE_MENTION, LIMITS, type Channel, type Message } from '@letopeiras/shared';
import { nameColor } from '../../lib/roles';
import { formatFull, formatTime, formatTimestamp, renderContent } from '../../lib/format';
import { Store, useStore } from '../../lib/store';
import type { PendingMessage } from '../../state/chat';
import { useSession } from '../../state/session';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Avatar } from '../ui/Avatar';
import { IconButton } from '../ui/controls';
import { useMentionAutocomplete } from './MentionSuggestions';

/** The message being edited, if any; one at a time, opened from the item or with ↑. */
export const editingMessage = new Store<{ id: number | null }>({ id: null });

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

  const mine = message.authorId === me?.id;
  const mentionsMe =
    me !== null && (message.mentionIds.includes(me.id) || (message.mentionsEveryone && !mine));

  const renderMention = (username: string, key: number) => {
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
      className={`message ${grouped ? 'grouped' : ''} ${editing ? 'editing' : ''} ${mentionsMe ? 'mentioned' : ''}`}
    >
      {grouped ? (
        <span className="message-gutter-time" title={formatFull(message.createdAt)}>
          {formatTime(message.createdAt)}
        </span>
      ) : (
        <Avatar user={author} size={40} />
      )}
      <div className="message-body">
        {!grouped && (
          <div className="message-header">
            <span className="message-author" style={{ color: nameColor(author, roles) }}>
              {author?.displayName ?? 'Alguém'}
            </span>
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
            {renderContent(message.content, renderMention)}
            {message.editedAt !== null && (
              <span className="message-edited" title={formatFull(message.editedAt)}>
                {' '}
                (editado)
              </span>
            )}
          </div>
        )}
      </div>
      {!editing && (mine || canDelete) && (
        <div className="message-actions">
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
