import type { FastifyBaseLogger } from 'fastify';
import { listChannels } from '../repo/channels';
import { findUserById } from '../repo/users';
import { canAccess } from '../services/access';
import { removeFromVoice } from '../services/livekit';
import type { AppContext } from './context';

/**
 * Call after anything that changes who can open which channel (tags, private channels).
 * Everyone gets a fresh `ready`, and people still in a voice channel they lost access to
 * are removed from it.
 */
export function applyPermissionChange(ctx: AppContext, log: FastifyBaseLogger): void {
  const { db, voice, gateway, config } = ctx;
  gateway.resync();

  const changed: number[] = [];
  for (const channel of listChannels(db)) {
    if (channel.type !== 'voice') continue;
    for (const { userId } of voice.get(channel.id).participants) {
      const user = findUserById(db, userId);
      if (user && canAccess(user, channel)) continue;
      changed.push(...voice.leave(channel.id, userId));
      removeFromVoice(config.livekit, channel.id, userId).catch((err: unknown) =>
        log.warn({ err, channelId: channel.id, userId }, 'Could not remove user from voice room'),
      );
    }
  }
  gateway.broadcastVoice(changed);
}
