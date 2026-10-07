import { z } from 'zod';

export const idSchema = z.number().int().positive();

export const userSchema = z.object({
  id: idSchema,
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  isAdmin: z.boolean(),
  /** Tags the user has. */
  roleIds: z.array(idSchema),
});
export type User = z.infer<typeof userSchema>;

/** A "tag": colors the member's name and can unlock private channels. */
export const roleSchema = z.object({
  id: idSchema,
  name: z.string(),
  /** #rrggbb */
  color: z.string(),
  /** Lower comes first; a member's name takes the color of their first tag. */
  position: z.number().int(),
});
export type Role = z.infer<typeof roleSchema>;

/** Groups text and voice channels in the sidebar. */
export const categorySchema = z.object({
  id: idSchema,
  name: z.string(),
  position: z.number().int(),
});
export type Category = z.infer<typeof categorySchema>;

export const channelTypeSchema = z.enum(['text', 'voice']);
export type ChannelType = z.infer<typeof channelTypeSchema>;

export const channelSchema = z.object({
  id: idSchema,
  name: z.string(),
  type: channelTypeSchema,
  position: z.number().int(),
  /** null: shown above all categories. */
  categoryId: idSchema.nullable(),
  /** Description shown in the channel header. */
  topic: z.string().nullable(),
  /** Only admins and members with one of `roleIds` can open/join it. */
  isPrivate: z.boolean(),
  roleIds: z.array(idSchema),
  /** Newest message id, for unread indicators (text channels only; null without access). */
  lastMessageId: idSchema.nullable(),
});
export type Channel = z.infer<typeof channelSchema>;

export const messageSchema = z.object({
  id: idSchema,
  channelId: idSchema,
  authorId: idSchema,
  content: z.string(),
  /** Unix epoch milliseconds. */
  createdAt: z.number().int(),
  editedAt: z.number().int().nullable(),
  /** Users marked with @username who can see the channel. */
  mentionIds: z.array(idSchema),
  /** The message uses @todos (everyone who can see the channel). */
  mentionsEveryone: z.boolean(),
});
export type Message = z.infer<typeof messageSchema>;

export const presenceStatusSchema = z.enum(['online', 'idle', 'offline']);
export type PresenceStatus = z.infer<typeof presenceStatusSchema>;

export const voiceParticipantSchema = z.object({
  userId: idSchema,
  muted: z.boolean(),
  deafened: z.boolean(),
  screenSharing: z.boolean(),
});
export type VoiceParticipant = z.infer<typeof voiceParticipantSchema>;

export const voiceChannelStateSchema = z.object({
  channelId: idSchema,
  participants: z.array(voiceParticipantSchema),
});
export type VoiceChannelState = z.infer<typeof voiceChannelStateSchema>;

export const readStateSchema = z.object({
  channelId: idSchema,
  lastReadMessageId: idSchema,
});
export type ReadState = z.infer<typeof readStateSchema>;
