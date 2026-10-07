// Writes a consistent copy of the database (safe while the server is running).
// Usage: node dist/cli/backup.mjs <destination file>   (infra/backup.sh runs it daily)
import { DEFAULT_DATABASE_PATH } from '../config';
import { backupDatabase } from '../db/backup';

const destination = process.argv[2];
if (!destination) {
  console.error('Usage: backup <destination file>');
  process.exit(1);
}

await backupDatabase(process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH, destination);
console.log(`Backup written to ${destination}`);
