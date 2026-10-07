import type { Role } from '@letopeiras/shared';
import { expectRow, type Db } from '../db';

const SELECT = 'SELECT id, name, color, position FROM roles';

export function listRoles(db: Db): Role[] {
  return db.prepare<[], Role>(`${SELECT} ORDER BY position, id`).all();
}

export function findRole(db: Db, id: number): Role | undefined {
  return db.prepare<[number], Role>(`${SELECT} WHERE id = ?`).get(id);
}

export function createRole(db: Db, input: { name: string; color: string }): Role {
  return expectRow(
    db
      .prepare<[string, string, number], Role>(
        `INSERT INTO roles (name, color, position, created_at)
         VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM roles), ?)
         RETURNING id, name, color, position`,
      )
      .get(input.name, input.color, Date.now()),
  );
}

export function updateRole(
  db: Db,
  id: number,
  changes: { name?: string | undefined; color?: string | undefined; position?: number | undefined },
): Role | undefined {
  return db
    .prepare<[string | null, string | null, number | null, number], Role>(
      `UPDATE roles SET name = COALESCE(?, name), color = COALESCE(?, color),
         position = COALESCE(?, position)
       WHERE id = ? RETURNING id, name, color, position`,
    )
    .get(changes.name ?? null, changes.color ?? null, changes.position ?? null, id);
}

export function deleteRole(db: Db, id: number): boolean {
  return db.prepare('DELETE FROM roles WHERE id = ?').run(id).changes === 1;
}

/** Replaces the user's tags. Unknown role ids are ignored. */
export function setUserRoles(db: Db, userId: number, roleIds: number[]): void {
  db.transaction(() => {
    db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(userId);
    const insert = db.prepare(
      'INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE id = ?',
    );
    for (const roleId of new Set(roleIds)) insert.run(userId, roleId);
  })();
}

/** Keeps only ids of roles that exist. */
export function existingRoleIds(db: Db, roleIds: number[]): number[] {
  const known = new Set(listRoles(db).map((r) => r.id));
  return [...new Set(roleIds)].filter((id) => known.has(id));
}
