import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from './migrate';

export type Db = Database.Database;

/** For statements that always return a row (e.g. INSERT … RETURNING). */
export function expectRow<T>(row: T | undefined): T {
  if (row === undefined) throw new Error('Expected the statement to return a row');
  return row;
}

/** Opens (creating if needed) the database and applies pending migrations. */
export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}
