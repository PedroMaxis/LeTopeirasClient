import type Database from 'better-sqlite3';
import { migrations as allMigrations, type Migration } from '../../migrations';

/**
 * Applies every migration newer than the database's `user_version`, each in its own
 * transaction. Returns the versions that were applied.
 */
export function migrate(db: Database.Database, migrations: Migration[] = allMigrations): number[] {
  const current = db.pragma('user_version', { simple: true }) as number;
  const pending = migrations
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    db.transaction(() => {
      db.exec(migration.sql);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
  return pending.map((m) => m.version);
}
