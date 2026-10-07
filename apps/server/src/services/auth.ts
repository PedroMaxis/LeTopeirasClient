import type { AuthResponse, User } from '@letopeiras/shared';
import type { Db } from '../db';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { badRequest, conflict, unauthorized } from '../lib/errors';
import { consumeInvite } from '../repo/invites';
import { createSession, findSessionByToken, type Session } from '../repo/sessions';
import { createUser, findUserById, findUserByUsername } from '../repo/users';

export interface AuthContext {
  user: User;
  session: Session;
}

const isUniqueViolation = (err: unknown) =>
  err instanceof Error && 'code' in err && err.code === 'SQLITE_CONSTRAINT_UNIQUE';

export async function register(
  db: Db,
  input: { inviteCode: string; username: string; displayName: string; password: string },
  sessionTtlMs: number,
): Promise<AuthResponse> {
  const passwordHash = await hashPassword(input.password);
  try {
    return db.transaction(() => {
      const user = createUser(db, {
        username: input.username,
        displayName: input.displayName,
        passwordHash,
      });
      if (!consumeInvite(db, input.inviteCode, user.id)) {
        throw badRequest('Convite inválido, expirado ou já usado', 'invalid_invite');
      }
      const { token } = createSession(db, user.id, sessionTtlMs);
      return { token, user };
    })();
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('Esse nome de usuário já existe', 'username_taken');
    throw err;
  }
}

// Verified against when the username doesn't exist, so both failures take the same time.
const dummyHash = hashPassword('timing-safety-placeholder');

export async function login(
  db: Db,
  input: { username: string; password: string },
  sessionTtlMs: number,
): Promise<AuthResponse> {
  const found = findUserByUsername(db, input.username);
  const valid = await verifyPassword(found?.passwordHash ?? (await dummyHash), input.password);
  if (!found || !valid) throw unauthorized('Usuário ou senha incorretos');

  const { passwordHash: _omit, ...user } = found;
  const { token } = createSession(db, user.id, sessionTtlMs);
  return { token, user };
}

/** Resolves a session token to its user, or undefined if invalid/expired. */
export function authenticate(db: Db, token: string): AuthContext | undefined {
  const session = findSessionByToken(db, token);
  if (!session) return undefined;
  const user = findUserById(db, session.userId);
  return user && { user, session };
}
