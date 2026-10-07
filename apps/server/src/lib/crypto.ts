import { createHash, randomBytes, randomInt } from 'node:crypto';
import argon2 from 'argon2';

/** Opaque session token handed to the client. Only its hash is stored. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// No 0/O/1/I/L, so codes are easy to read aloud.
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateInviteCode(length = 10): string {
  let code = '';
  for (let i = 0; i < length; i++) code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  return code;
}

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
