import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db';
import { backupDatabase } from '../src/db/backup';
import { createUser, findUserByUsername } from '../src/repo/users';

describe('backupDatabase', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('copies the data while the source stays open (WAL)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'letopeiras-backup-'));
    dirs.push(dir);
    const db = openDatabase(join(dir, 'live.db'));
    createUser(db, { username: 'maria', displayName: 'Maria', passwordHash: 'x', isAdmin: false });

    await backupDatabase(join(dir, 'live.db'), join(dir, 'backups', 'copy.db'));
    db.close();

    const copy = openDatabase(join(dir, 'backups', 'copy.db'));
    expect(findUserByUsername(copy, 'maria')?.displayName).toBe('Maria');
    copy.close();
  });

  it('refuses a source that does not exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'letopeiras-backup-'));
    dirs.push(dir);
    await expect(backupDatabase(join(dir, 'missing.db'), join(dir, 'copy.db'))).rejects.toThrow();
  });
});
