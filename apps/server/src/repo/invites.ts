import type { Db } from '../db';
import { generateInviteCode } from '../lib/crypto';

export interface Invite {
  code: string;
  expiresAt: number;
}

export function createInvite(db: Db, createdBy: number, ttlMs: number): Invite {
  const now = Date.now();
  const invite = { code: generateInviteCode(), expiresAt: now + ttlMs };
  db.prepare(
    'INSERT INTO invites (code, created_by, expires_at, created_at) VALUES (?, ?, ?, ?)',
  ).run(invite.code, createdBy, invite.expiresAt, now);
  return invite;
}

/**
 * Marks an unused, unexpired invite as used by `userId`. Returns false if the code is
 * unknown, expired or already used. Call inside the same transaction that creates the user.
 */
export function consumeInvite(db: Db, code: string, userId: number): boolean {
  const result = db
    .prepare(
      `UPDATE invites SET used_by = ?
       WHERE code = ? AND used_by IS NULL AND expires_at > ?`,
    )
    .run(userId, code.toUpperCase(), Date.now());
  return result.changes === 1;
}
