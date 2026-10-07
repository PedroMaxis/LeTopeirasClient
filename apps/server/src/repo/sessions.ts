import { expectRow, type Db } from '../db';
import { generateSessionToken, hashToken } from '../lib/crypto';

export interface Session {
  id: number;
  userId: number;
  expiresAt: number;
}

interface SessionRow {
  id: number;
  user_id: number;
  expires_at: number;
}

/** Creates a session and returns it with the plain token (shown to the client once). */
export function createSession(
  db: Db,
  userId: number,
  ttlMs: number,
): { session: Session; token: string } {
  const token = generateSessionToken();
  const now = Date.now();
  const row = expectRow(
    db
      .prepare<[number, string, number, number], SessionRow>(
        `INSERT INTO sessions (user_id, token_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?) RETURNING id, user_id, expires_at`,
      )
      .get(userId, hashToken(token), now, now + ttlMs),
  );
  return { session: { id: row.id, userId: row.user_id, expiresAt: row.expires_at }, token };
}

/** Returns the session for a token if it exists and has not expired. */
export function findSessionByToken(db: Db, token: string): Session | undefined {
  const row = db
    .prepare<[string, number], SessionRow>(
      'SELECT id, user_id, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?',
    )
    .get(hashToken(token), Date.now());
  return row && { id: row.id, userId: row.user_id, expiresAt: row.expires_at };
}

export function deleteSession(db: Db, sessionId: number): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function deleteExpiredSessions(db: Db): number {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now()).changes;
}

/** Logs out every other device, e.g. after a password change. */
export function deleteOtherSessions(db: Db, userId: number, keepSessionId: number): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, keepSessionId);
}
