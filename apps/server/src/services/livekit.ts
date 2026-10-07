import { parseVoiceRoomName, voiceRoomName, type User } from '@letopeiras/shared';
import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
  WebhookReceiver,
  type ParticipantInfo,
  type WebhookEvent,
} from 'livekit-server-sdk';
import type { ServerConfig } from '../config';
import type { Db } from '../db';
import { findChannel } from '../repo/channels';
import { findUserById } from '../repo/users';
import type { VoiceStateStore } from './voice-state';

type LiveKitConfig = ServerConfig['livekit'];

const VOICE_TOKEN_TTL = '6h';

export async function createVoiceToken(
  config: LiveKitConfig,
  user: User,
  channelId: number,
): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: String(user.id),
    name: user.displayName,
    ttl: VOICE_TOKEN_TTL,
  });
  token.addGrant({
    room: voiceRoomName(channelId),
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
    // No cameras in this app.
    canPublishSources: [
      TrackSource.MICROPHONE,
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
    ],
  });
  return token.toJwt();
}

export function createWebhookReceiver(config: LiveKitConfig): WebhookReceiver {
  return new WebhookReceiver(config.apiKey, config.apiSecret);
}

const parseUserId = (identity: string | undefined): number | null => {
  const id = Number(identity);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/** Filters out rooms and identities that don't map to our voice channels and users. */
export interface VoiceFilter {
  isKnownUser: (userId: number) => boolean;
  isVoiceChannel: (channelId: number) => boolean;
}

export const voiceFilter = (db: Db): VoiceFilter => ({
  isKnownUser: (userId) => findUserById(db, userId) !== undefined,
  isVoiceChannel: (channelId) => findChannel(db, channelId)?.type === 'voice',
});

/** Applies a LiveKit webhook to the voice state. Returns the channel ids whose state changed. */
export function applyWebhookEvent(
  store: VoiceStateStore,
  event: WebhookEvent,
  filter: VoiceFilter,
): number[] {
  const channelId = event.room ? parseVoiceRoomName(event.room.name) : null;
  if (channelId === null) return [];

  if (event.event === 'room_finished') return store.clearChannel(channelId);
  if (!filter.isVoiceChannel(channelId)) return [];

  const userId = parseUserId(event.participant?.identity);
  if (userId === null || !filter.isKnownUser(userId)) return [];

  switch (event.event) {
    case 'participant_joined':
      return store.join(channelId, userId);
    case 'participant_left':
    case 'participant_connection_aborted':
      return store.leave(channelId, userId);
    case 'track_published':
    case 'track_unpublished':
      if (event.track?.source !== TrackSource.SCREEN_SHARE) return [];
      return store.setScreenSharing(channelId, userId, event.event === 'track_published');
    default:
      return [];
  }
}

const isScreenSharing = (participant: ParticipantInfo) =>
  participant.tracks.some((t) => t.source === TrackSource.SCREEN_SHARE);

/**
 * Rebuilds the voice state from the LiveKit API, e.g. after a server restart where
 * webhooks were missed. Returns the channel ids that were touched.
 */
export async function syncVoiceState(
  config: LiveKitConfig,
  store: VoiceStateStore,
  filter: VoiceFilter,
): Promise<number[]> {
  const client = new RoomServiceClient(config.apiUrl, config.apiKey, config.apiSecret);
  const snapshot = new Map<number, Map<number, { screenSharing: boolean }>>();

  for (const room of await client.listRooms()) {
    const channelId = parseVoiceRoomName(room.name);
    if (channelId === null || !filter.isVoiceChannel(channelId)) continue;
    const members = new Map<number, { screenSharing: boolean }>();
    for (const participant of await client.listParticipants(room.name)) {
      const userId = parseUserId(participant.identity);
      if (userId !== null && filter.isKnownUser(userId)) {
        members.set(userId, { screenSharing: isScreenSharing(participant) });
      }
    }
    snapshot.set(channelId, members);
  }
  return store.replaceAll(snapshot);
}

/** Kicks someone out of a voice channel's LiveKit room (e.g. they lost access to it). */
export async function removeFromVoice(
  config: LiveKitConfig,
  channelId: number,
  userId: number,
): Promise<void> {
  const client = new RoomServiceClient(config.apiUrl, config.apiKey, config.apiSecret);
  await client.removeParticipant(voiceRoomName(channelId), String(userId));
}
