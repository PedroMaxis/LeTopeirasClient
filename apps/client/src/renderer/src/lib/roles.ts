import type { Channel, Role, User } from '@letopeiras/shared';

/** Same rule as the server (services/access.ts): admins see all, private needs a tag. */
export function canAccess(user: User | null | undefined, channel: Channel): boolean {
  if (!user) return false;
  if (user.isAdmin || !channel.isPrivate) return true;
  return channel.roleIds.some((id) => user.roleIds.includes(id));
}

/** The user's first tag by position (`roles` must be sorted), which colors their name. */
export function topRole(user: User | undefined, roles: Role[]): Role | undefined {
  if (!user?.roleIds.length) return undefined;
  return roles.find((role) => user.roleIds.includes(role.id));
}

export const nameColor = (user: User | undefined, roles: Role[]): string | undefined =>
  topRole(user, roles)?.color;
