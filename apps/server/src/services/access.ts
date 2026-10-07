import type { Channel, User } from '@letopeiras/shared';
import type { Db } from '../db';
import { forbidden, notFound } from '../lib/errors';
import { findChannel } from '../repo/channels';

/** Admins see everything; a private channel needs one of its tags. */
export function canAccess(user: User, channel: Channel): boolean {
  if (user.isAdmin || !channel.isPrivate) return true;
  return channel.roleIds.some((roleId) => user.roleIds.includes(roleId));
}

/**
 * The channel as `user` may see it. Locked channels stay in the list (shown with a
 * padlock) but don't reveal activity.
 */
export function channelForViewer(user: User, channel: Channel): Channel {
  return canAccess(user, channel) ? channel : { ...channel, lastMessageId: null };
}

/** The channel, if it exists and `user` can open it. */
export function requireAccess(db: Db, user: User, channelId: number): Channel {
  const channel = findChannel(db, channelId);
  if (!channel) throw notFound('Canal não encontrado');
  if (!canAccess(user, channel)) throw forbidden('Esse canal é privado');
  return channel;
}
