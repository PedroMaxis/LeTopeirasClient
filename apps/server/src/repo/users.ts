import type { User } from '@letopeiras/shared';
import { expectRow, type Db } from '../db';

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  avatar_url: string | null;
  is_admin: 0 | 1;
  created_at: number;
  role_ids: string | null;
}

export interface UserWithPassword extends User {
  passwordHash: string;
}

const toUser = (row: UserRow): User => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  avatarUrl: row.avatar_url,
  isAdmin: row.is_admin === 1,
  roleIds: row.role_ids ? row.role_ids.split(',').map(Number) : [],
});

const SELECT_USER = `
  SELECT u.*, (SELECT group_concat(role_id) FROM user_roles ur WHERE ur.user_id = u.id) AS role_ids
  FROM users u`;

export function createUser(
  db: Db,
  input: { username: string; displayName: string; passwordHash: string; isAdmin?: boolean },
): User {
  const row = db
    .prepare<[string, string, string, number, number], UserRow>(
      `INSERT INTO users (username, display_name, password_hash, is_admin, created_at)
       VALUES (?, ?, ?, ?, ?) RETURNING *, NULL AS role_ids`,
    )
    .get(input.username, input.displayName, input.passwordHash, input.isAdmin ? 1 : 0, Date.now());
  return toUser(expectRow(row));
}

export function findUserById(db: Db, id: number): User | undefined {
  const row = db.prepare<[number], UserRow>(`${SELECT_USER} WHERE u.id = ?`).get(id);
  return row && toUser(row);
}

export function findUserByUsername(db: Db, username: string): UserWithPassword | undefined {
  const row = db.prepare<[string], UserRow>(`${SELECT_USER} WHERE u.username = ?`).get(username);
  return row && { ...toUser(row), passwordHash: row.password_hash };
}

export function listUsers(db: Db): User[] {
  return db.prepare<[], UserRow>(`${SELECT_USER} ORDER BY u.id`).all().map(toUser);
}

export function updateDisplayName(db: Db, id: number, displayName: string): void {
  db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, id);
}

export function updatePasswordHash(db: Db, id: number, passwordHash: string): void {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
}
