// Builds the addon if it's missing (Windows only). Used by the client's dev/dist scripts so a
// fresh clone works without a separate step; elsewhere it's a no-op.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'build', 'Release', 'audio_capture.node');

if (process.platform !== 'win32') {
  console.log('[audio-capture] skipped: Windows only');
} else if (existsSync(output) && !process.argv.includes('--force')) {
  console.log('[audio-capture] already built');
} else {
  execSync('pnpm run build:native', { cwd: root, stdio: 'inherit' });
}
