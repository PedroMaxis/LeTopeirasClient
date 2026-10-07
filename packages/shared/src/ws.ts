// WebSocket protocol. Every frame is JSON: { type, data }.
import { z } from 'zod';
import { LIMITS } from './constants';
import {
  categorySchema,
  channelSchema,
  idSchema,
  messageSchema,
  presenceStatusSchema,
  readStateSchema,
  roleSchema,
  userSchema,
  voiceChannelStateSchema,
} from './entities';

const messageContentSchema = z.string().trim().min(1).max(LIMITS.messageMax);

// ---------------------------------------------------------------------------
// Client → server

export const clientEventSchema = z.discriminatedUnion('type', [
  /** Must be the first frame after connecting. */
  z.object({ type: z.literal('auth'), data: z.object({ token: z.string().min(1).max(256) }) }),
  z.object({
    type: z.literal('message.send'),
    data: z.object({
      channelId: idSchema,
      content: messageContentSchema,
      /** Echoed back in message.created so the sender can match its optimistic copy. */
      nonce: z.string().max(64).optional(),
    }),
  }),
  z.object({
    type: z.literal('message.edit'),
    data: z.object({ messageId: idSchema, content: messageContentSchema }),
  }),
  z.object({ type: z.literal('message.delete'), data: z.object({ messageId: idSchema }) }),
  z.object({ type: z.literal('typing.start'), data: z.object({ channelId: idSchema }) }),
  z.object({
    type: z.literal('channel.read'),
    data: z.object({ channelId: idSchema, messageId: idSchema }),
  }),
  /** "Ausente" after a while without input on the PC, "online" when back. */
  z.object({
    type: z.literal('presence.update'),
    data: z.object({ status: z.enum(['online', 'idle']) }),
  }),
  /** Self mute/deafen; LiveKit doesn't know about deafen, so the client reports both. */
  z.object({
    type: z.literal('voice.update'),
    data: z.object({ muted: z.boolean(), deafened: z.boolean() }),
  }),
]);
export type ClientEvent = z.infer<typeof clientEventSchema>;
export type ClientEventInput = z.input<typeof clientEventSchema>;
export type ClientEventType = ClientEvent['type'];

// ---------------------------------------------------------------------------
// Server → client

export const readyEventDataSchema = z.object({
  user: userSchema,
  users: z.array(userSchema),
  channels: z.array(channelSchema),
  categories: z.array(categorySchema),
  roles: z.array(roleSchema),
  /** Users currently connected (anyone missing is offline). */
  presence: z.array(z.object({ userId: idSchema, status: z.enum(['online', 'idle']) })),
  voiceStates: z.array(voiceChannelStateSchema),
  readStates: z.array(readStateSchema),
  /** Unread messages that mention you, per channel (channels with none are left out). */
  mentions: z.array(z.object({ channelId: idSchema, count: z.number().int().positive() })),
});
export type ReadyEventData = z.infer<typeof readyEventDataSchema>;

export const serverEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), data: readyEventDataSchema }),
  z.object({
    type: z.literal('message.created'),
    data: z.object({ message: messageSchema, nonce: z.string().optional() }),
  }),
  z.object({ type: z.literal('message.updated'), data: z.object({ message: messageSchema }) }),
  z.object({
    type: z.literal('message.deleted'),
    data: z.object({ channelId: idSchema, messageId: idSchema }),
  }),
  z.object({
    type: z.literal('presence.updated'),
    data: z.object({ userId: idSchema, status: presenceStatusSchema }),
  }),
  z.object({
    type: z.literal('typing'),
    data: z.object({ channelId: idSchema, userId: idSchema }),
  }),
  z.object({ type: z.literal('voice.state'), data: voiceChannelStateSchema }),
  z.object({ type: z.literal('user.created'), data: z.object({ user: userSchema }) }),
  /** Display name or tags changed. */
  z.object({ type: z.literal('user.updated'), data: z.object({ user: userSchema }) }),
  z.object({ type: z.literal('category.created'), data: z.object({ category: categorySchema }) }),
  z.object({ type: z.literal('category.updated'), data: z.object({ category: categorySchema }) }),
  z.object({ type: z.literal('category.deleted'), data: z.object({ categoryId: idSchema }) }),
  z.object({ type: z.literal('role.created'), data: z.object({ role: roleSchema }) }),
  z.object({ type: z.literal('role.updated'), data: z.object({ role: roleSchema }) }),
  z.object({ type: z.literal('channel.created'), data: z.object({ channel: channelSchema }) }),
  z.object({ type: z.literal('channel.updated'), data: z.object({ channel: channelSchema }) }),
  z.object({ type: z.literal('channel.deleted'), data: z.object({ channelId: idSchema }) }),
  /** Read position changed from another of the user's own sessions. */
  z.object({ type: z.literal('channel.read'), data: readStateSchema }),
  /** A client event was rejected. `ref` is the client event type. */
  z.object({
    type: z.literal('error'),
    data: z.object({ code: z.string(), message: z.string(), ref: z.string().optional() }),
  }),
]);
export type ServerEvent = z.infer<typeof serverEventSchema>;
export type ServerEventType = ServerEvent['type'];
export type ServerEventOf<T extends ServerEventType> = Extract<ServerEvent, { type: T }>;
