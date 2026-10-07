// Creates the admin user (the only one who can create invites) with a random password.
// Usage: pnpm --filter @letopeiras/server create-admin <username> [display name]
import { randomBytes } from 'node:crypto';
import { displayNameSchema, usernameSchema } from '@letopeiras/shared';
import { DEFAULT_DATABASE_PATH } from '../config';
import { openDatabase } from '../db';
import { hashPassword } from '../lib/crypto';
import { createUser, findUserByUsername } from '../repo/users';

const [rawUsername, ...nameParts] = process.argv.slice(2);
const username = usernameSchema.safeParse(rawUsername);
const displayName = displayNameSchema.safeParse(nameParts.join(' ') || rawUsername);
if (!username.success || !displayName.success) {
  console.error('Usage: create-admin <username> [display name]');
  console.error('Username: 3-32 chars, lowercase letters, digits, "_" and "."');
  process.exit(1);
}

const db = openDatabase(process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH);
if (findUserByUsername(db, username.data)) {
  console.error(`User "${username.data}" already exists`);
  process.exit(1);
}

const password = randomBytes(12).toString('base64url');
const user = createUser(db, {
  username: username.data,
  displayName: displayName.data,
  passwordHash: await hashPassword(password),
  isAdmin: true,
});
db.close();

console.log(`Admin created: ${user.username} (id ${user.id})`);
console.log(`Password: ${password}`);
console.log('Save it now; it is not stored anywhere in plain text.');
