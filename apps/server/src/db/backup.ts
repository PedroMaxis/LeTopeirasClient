import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

/**
 * Copies the database at `source` to `destination` with SQLite's online backup API, so
 * it is consistent even while the server keeps writing (WAL included).
 */
export async function backupDatabase(source: string, destination: string): Promise<void> {
  mkdirSync(dirname(destination), { recursive: true });
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await db.backup(destination);
  } finally {
    db.close();
  }
}
