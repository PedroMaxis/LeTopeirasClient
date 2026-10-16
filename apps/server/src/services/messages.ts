import {
  isReactionEmoji,
  LIMITS,
  mentionsEveryone,
  parseMentions,
  type Channel,
  type Message,
  type Reaction,
  type User,
} from '@letopeiras/shared';
import { expectRow, type Db } from '../db';
import { badRequest, forbidden, notFound } from '../lib/errors';
import {
  addReaction,
  countReactionEmojis,
  createMessage,
  deleteMessage,
  findMessage,
  hasReactionEmoji,
  listMessages,
  listReactions,
  removeReaction,
  updateMessageContent,
} from '../repo/messages';
import { claimAttachments, attachmentHashes } from '../repo/attachments';
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

export function sendMessage(
  db: Db,
  author: User,
  channelId: number,
  content: string,
  reply: { replyToId?: number | undefined; replyPing?: boolean | undefined } = {},
  attachmentIds: number[] = [],
): Message {
  const channel = requireTextChannel(db, author, channelId);
  if (!content && attachmentIds.length === 0) {
    throw badRequest('A mensagem está vazia', 'empty_message');
  }
  const mentionIds = resolveMentions(db, author, channel, content);
  if (reply.replyToId !== undefined) {
    const original = findMessage(db, reply.replyToId);
    if (!original || original.channelId !== channelId) {
      throw notFound('A mensagem que você está respondendo não existe mais');
    }
    // Replying pings the original author unless turned off (they can see the channel).
    if (reply.replyPing !== false && original.authorId !== author.id) {
      mentionIds.push(original.authorId);
    }
  }
  return db.transaction(() => {
    const sent = createMessage(db, {
      channelId,
      authorId: author.id,
      content,
      mentionIds,
      mentionsEveryone: mentionsEveryone(content),
      replyToId: reply.replyToId,
    });
    // Throwing rolls the insert back too, so a message never goes out without its images.
    if (attachmentIds.length && !claimAttachments(db, sent.id, author.id, attachmentIds)) {
      throw badRequest(
        'Uma das imagens não está mais disponível, envie de novo',
        'attachment_not_found',
      );
    }
    const message = expectRow(findMessage(db, sent.id));
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

/** The author or an admin can delete a message. Returns it and the hashes of the files it used. */
export function removeMessage(
  db: Db,
  user: User,
  messageId: number,
): { message: Message; hashes: string[] } {
  const message = requireMessage(db, user, messageId);
  if (message.authorId !== user.id && !user.isAdmin) {
    throw forbidden('Você só pode apagar suas próprias mensagens');
  }
  const hashes = attachmentHashes(db, messageId);
  deleteMessage(db, messageId);
  return { message, hashes };
}

/**
 * Adds or removes the user's `emoji` on a message they can see. Returns the message and
 * its reactions now, or null when nothing changed (already there / not there).
 */
export function react(
  db: Db,
  user: User,
  messageId: number,
  emoji: string,
  add: boolean,
): { message: Message; reactions: Reaction[] } | null {
  if (!isReactionEmoji(emoji)) throw badRequest('Reação precisa ser um emoji', 'invalid_emoji');
  const message = requireMessage(db, user, messageId);
  const changed = db.transaction(() => {
    if (!add) return removeReaction(db, messageId, user.id, emoji);
    if (
      !hasReactionEmoji(db, messageId, emoji) &&
      countReactionEmojis(db, messageId) >= LIMITS.reactionsPerMessage
    ) {
      throw badRequest('Essa mensagem já tem reações demais', 'too_many_reactions');
    }
    return addReaction(db, messageId, user.id, emoji);
  })();
  return changed ? { message, reactions: listReactions(db, messageId) } : null;
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
