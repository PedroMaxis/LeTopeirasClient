import type { Category } from '@letopeiras/shared';
import { expectRow, type Db } from '../db';

const SELECT = 'SELECT id, name, position FROM categories';

export function listCategories(db: Db): Category[] {
  return db.prepare<[], Category>(`${SELECT} ORDER BY position, id`).all();
}

export function findCategory(db: Db, id: number): Category | undefined {
  return db.prepare<[number], Category>(`${SELECT} WHERE id = ?`).get(id);
}

export function createCategory(db: Db, name: string): Category {
  return expectRow(
    db
      .prepare<[string, number], Category>(
        `INSERT INTO categories (name, position, created_at)
         VALUES (?, (SELECT COALESCE(MAX(position), -1) + 1 FROM categories), ?)
         RETURNING id, name, position`,
      )
      .get(name, Date.now()),
  );
}

export function updateCategory(
  db: Db,
  id: number,
  changes: { name?: string | undefined; position?: number | undefined },
): Category | undefined {
  return db
    .prepare<[string | null, number | null, number], Category>(
      `UPDATE categories SET name = COALESCE(?, name), position = COALESCE(?, position)
       WHERE id = ? RETURNING id, name, position`,
    )
    .get(changes.name ?? null, changes.position ?? null, id);
}

/** Its channels move to "no category" (ON DELETE SET NULL). */
export function deleteCategory(db: Db, id: number): boolean {
  return db.prepare('DELETE FROM categories WHERE id = ?').run(id).changes === 1;
}
