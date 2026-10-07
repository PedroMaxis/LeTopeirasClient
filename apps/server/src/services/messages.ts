import {
  mentionsEveryone,
  parseMentions,
  type Channel,
  type Message,
  type User,
} from '@letopeiras/shared';
import { expectRow, type Db } from '../db';
import { badRequest, forbidden, notFound } from '../lib/errors';
import {
  createMessage,
  deleteMessage,
  findMessage,
  listMessages,
  updateMessageContent,
} from '../repo/messages';
import { markRead } from '../repo/read-state';
import { findUserByUsername } from '../repo/users';
import { canAccess, requireAccess } from './access';

/** Ids of the @mentioned users who can see the channel (never the author). */
function resolveMentions(db: Db, author: User, channel: Channel, content: string): number[] {
  return parseMentions(content).flatMap((username) => {
    const found = findUserByUsername(db, username);
    if (!found || found.id === author.id) return [];
    const { passwordHash: _omit, ...user } = found;
    return canAccess(user, channel) ? [user.id] : [];
  });
}

/** A text channel `user` can open. */
export function requireTextChannel(db: Db, user: User, channelId: number): Channel {
  const channel = requireAccess(db, user, channelId);
  if (channel.type !== 'text') throw badRequest('Esse canal não é de texto', 'not_text_channel');
  return channel;
}

export function sendMessage(db: Db, author: User, channelId: number, content: string): Message {
  const channel = requireTextChannel(db, author, channelId);
  const mentionIds = resolveMentions(db, author, channel, content);
  return db.transaction(() => {
    const message = createMessage(db, {
      channelId,
      authorId: author.id,
      content,
      mentionIds,
      mentionsEveryone: mentionsEveryone(content),
    });
    // Your own message never counts as unread.
    markRead(db, author.id, channelId, message.id);
    return message;
  })();
}

/** A message in a channel `user` can open (losing access also hides your old messages). */
function requireMessage(db: Db, user: User, messageId: number): Message {
  const message = findMessage(db, messageId);
  if (!message) throw notFound('Mensagem não encontrada');
  requireAccess(db, user, message.channelId);
  return message;
}

/** Only the author can edit a message. */
export function editMessage(db: Db, user: User, messageId: number, content: string): Message {
  const message = requireMessage(db, user, messageId);
  if (message.authorId !== user.id) throw forbidden('Você só pode editar suas próprias mensagens');
  const channel = requireTextChannel(db, user, message.channelId);
  const mentionIds = resolveMentions(db, user, channel, content);
  return expectRow(
    updateMessageContent(db, messageId, content, {
      mentionIds,
      mentionsEveryone: mentionsEveryone(content),
    }),
  );
}

/** The author or an admin can delete a message. Returns the deleted message. */
export function removeMessage(db: Db, user: User, messageId: number): Message {
  const message = requireMessage(db, user, messageId);
  if (message.authorId !== user.id && !user.isAdmin) {
    throw forbidden('Você só pode apagar suas próprias mensagens');
  }
  deleteMessage(db, messageId);
  return message;
}

export function messageHistory(
  db: Db,
  user: User,
  channelId: number,
  options: { before?: number | undefined; limit: number },
) {
  requireTextChannel(db, user, channelId);
  return listMessages(db, channelId, options);
}

/** Moves the user's read marker. Returns true if it moved forward. */
export function markChannelRead(db: Db, user: User, channelId: number, messageId: number): boolean {
  requireTextChannel(db, user, channelId);
  const message = findMessage(db, messageId);
  if (!message || message.channelId !== channelId) throw notFound('Mensagem não encontrada');
  return markRead(db, user.id, channelId, messageId);
}
