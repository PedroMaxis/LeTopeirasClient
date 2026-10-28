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

/** One emoji on a message and who reacted with it, in the order they did. */
export const reactionSchema = z.object({
  emoji: z.string(),
  userIds: z.array(idSchema),
});
export type Reaction = z.infer<typeof reactionSchema>;

/** Preview of a link in a message, fetched by the server. */
export const embedSchema = z.object({
  url: z.string(),
  /** `youtube`: a video (thumbnail + `videoId`); `image`: the link is an image itself. */
  kind: z.enum(['link', 'youtube', 'image']),
  title: z.string().nullable(),
  description: z.string().nullable(),
  siteName: z.string().nullable(),
  /** http(s) URL of a picture to show. */
  image: z.string().nullable(),
  /** The site's theme color (#rrggbb), for the side bar. */
  color: z.string().nullable(),
  videoId: z.string().nullable(),
});
export type Embed = z.infer<typeof embedSchema>;

/** An image sent with a message, stored by the server as WebP. */
export const attachmentSchema = z.object({
  id: idSchema,
  /** Path on our server (`/files/<hash>.webp`); the client prefixes the server URL. */
  url: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

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
  /** The message this one answers. Defaults keep older servers' messages parseable. */
  replyToId: idSchema.nullable().default(null),
  /** A snippet of that message; null when it was deleted (or there's none). */
  replyTo: z.object({ authorId: idSchema, content: z.string() }).nullable().default(null),
  /** By the time each emoji was first used. */
  reactions: z.array(reactionSchema).default([]),
  /** Link previews; filled in shortly after sending (a `message.updated` follows). */
  embeds: z.array(embedSchema).default([]),
  /** Images sent with the message (it may have no text then). */
  attachments: z.array(attachmentSchema).default([]),
});
export type Message = z.infer<typeof messageSchema>;

export const presenceStatusSchema = z.enum(['online', 'idle', 'offline']);
export type PresenceStatus = z.infer<typeof presenceStatusSchema>;

export const voiceParticipantSchema = z.object({
  userId: idSchema,
  muted: z.boolean(),
  deafened: z.boolean(),
  screenSharing: z.boolean(),
  camera: z.boolean().default(false),
  /** Ids of the people whose screen share this participant is watching. */
  watching: z.array(idSchema).default([]),
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

/** A YouTube video as search and the queue describe it. */
export const musicVideoSchema = z.object({
  videoId: z.string().regex(/^[\w-]{6,20}$/),
  title: z.string(),
  author: z.string(),
  /** null for live streams, and when the server has no YouTube key (oEmbed has no duration). */
  durationMs: z.number().int().positive().nullable(),
  thumbnailUrl: z.string(),
});
export type MusicVideo = z.infer<typeof musicVideoSchema>;

export const musicTrackSchema = musicVideoSchema.extend({
  /** Unique per queued song, so the same video can be queued twice. */
  id: idSchema,
  addedBy: idSchema,
});
export type MusicTrack = z.infer<typeof musicTrackSchema>;

export const musicCurrentSchema = z.object({
  track: musicTrackSchema,
  paused: z.boolean(),
  /** Where the song was at `at`. */
  positionMs: z.number().int().nonnegative(),
  /** Server clock (ms) when `positionMs` was taken. */
  at: z.number(),
});
export type MusicCurrent = z.infer<typeof musicCurrentSchema>;

/** What is playing in a voice room and what comes next. */
export const musicChannelStateSchema = z.object({
  channelId: idSchema,
  current: musicCurrentSchema.nullable(),
  queue: z.array(musicTrackSchema),
  /** Server clock (ms) when this was sent; clients derive their offset from it. */
  serverNow: z.number(),
});
export type MusicChannelState = z.infer<typeof musicChannelStateSchema>;
