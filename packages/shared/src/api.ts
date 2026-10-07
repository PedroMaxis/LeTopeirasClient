// REST request/response contracts.
import { z } from 'zod';
import { EVERYONE_MENTION, LIMITS } from './constants';
import {
  categorySchema,
  channelSchema,
  channelTypeSchema,
  idSchema,
  messageSchema,
  roleSchema,
  userSchema,
} from './entities';

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(LIMITS.usernameMin)
  .max(LIMITS.usernameMax)
  .regex(/^[a-z0-9_.]+$/, 'Use apenas letras minúsculas, números, "_" e "."')
  .refine((name) => name !== EVERYONE_MENTION, 'Esse nome é reservado para o @todos');

export const displayNameSchema = z.string().trim().min(1).max(LIMITS.displayNameMax);

export const passwordSchema = z.string().min(LIMITS.passwordMin).max(LIMITS.passwordMax);

export const registerRequestSchema = z.object({
  inviteCode: z.string().trim().min(1).max(64),
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
});
export type RegisterRequest = z.input<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(LIMITS.usernameMax),
  password: z.string().min(1).max(LIMITS.passwordMax),
});
export type LoginRequest = z.input<typeof loginRequestSchema>;

export const authResponseSchema = z.object({
  token: z.string(),
  user: userSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const createInviteRequestSchema = z.object({
  expiresInHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(24 * 7),
});
export type CreateInviteRequest = z.input<typeof createInviteRequestSchema>;

export const inviteResponseSchema = z.object({
  code: z.string(),
  expiresAt: z.number().int(),
});
export type InviteResponse = z.infer<typeof inviteResponseSchema>;

export const channelNameSchema = z.string().trim().min(1).max(LIMITS.channelNameMax);
const channelTopicSchema = z.string().trim().max(LIMITS.channelTopicMax);
const roleIdsSchema = z.array(idSchema).max(100);

export const createChannelRequestSchema = z.object({
  name: channelNameSchema,
  type: channelTypeSchema,
  categoryId: idSchema.nullable().optional(),
  topic: channelTopicSchema.optional(),
  isPrivate: z.boolean().optional(),
  roleIds: roleIdsSchema.optional(),
});
export type CreateChannelRequest = z.input<typeof createChannelRequestSchema>;

export const updateChannelRequestSchema = z
  .object({
    name: channelNameSchema.optional(),
    position: z.number().int().min(0).optional(),
    categoryId: idSchema.nullable().optional(),
    /** Empty string clears it. */
    topic: channelTopicSchema.optional(),
    isPrivate: z.boolean().optional(),
    roleIds: roleIdsSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nada para atualizar');
export type UpdateChannelRequest = z.input<typeof updateChannelRequestSchema>;

export const categoryNameSchema = z.string().trim().min(1).max(LIMITS.categoryNameMax);

export const createCategoryRequestSchema = z.object({ name: categoryNameSchema });
export type CreateCategoryRequest = z.input<typeof createCategoryRequestSchema>;

export const updateCategoryRequestSchema = z
  .object({
    name: categoryNameSchema.optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine((v) => v.name !== undefined || v.position !== undefined, 'Nada para atualizar');
export type UpdateCategoryRequest = z.input<typeof updateCategoryRequestSchema>;

export const categoryResponseSchema = categorySchema;

const roleNameSchema = z.string().trim().min(1).max(LIMITS.roleNameMax);
const roleColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor no formato #rrggbb')
  .transform((c) => c.toLowerCase());

export const createRoleRequestSchema = z.object({ name: roleNameSchema, color: roleColorSchema });
export type CreateRoleRequest = z.input<typeof createRoleRequestSchema>;

export const updateRoleRequestSchema = z
  .object({
    name: roleNameSchema.optional(),
    color: roleColorSchema.optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nada para atualizar');
export type UpdateRoleRequest = z.input<typeof updateRoleRequestSchema>;

export const roleResponseSchema = roleSchema;

export const setUserRolesRequestSchema = z.object({ roleIds: roleIdsSchema });
export type SetUserRolesRequest = z.input<typeof setUserRolesRequestSchema>;

export const updateProfileRequestSchema = z.object({ displayName: displayNameSchema });
export type UpdateProfileRequest = z.input<typeof updateProfileRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(LIMITS.passwordMax),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.input<typeof changePasswordRequestSchema>;

export const userResponseSchema = userSchema;

export const channelResponseSchema = channelSchema;

export const messageHistoryQuerySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITS.historyPageMax)
    .default(LIMITS.historyPageDefault),
});
export type MessageHistoryQuery = z.input<typeof messageHistoryQuerySchema>;

/** Messages older than `before`, sorted oldest → newest. */
export const messageHistoryResponseSchema = z.object({
  messages: z.array(messageSchema),
  hasMore: z.boolean(),
});
export type MessageHistoryResponse = z.infer<typeof messageHistoryResponseSchema>;

export const voiceTokenRequestSchema = z.object({
  channelId: idSchema,
});
export type VoiceTokenRequest = z.input<typeof voiceTokenRequestSchema>;

export const voiceTokenResponseSchema = z.object({
  url: z.string(),
  token: z.string(),
});
export type VoiceTokenResponse = z.infer<typeof voiceTokenResponseSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
