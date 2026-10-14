import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const base = {
  LIVEKIT_URL: 'ws://127.0.0.1:7880',
  LIVEKIT_API_URL: 'http://127.0.0.1:7880',
  LIVEKIT_API_KEY: 'k',
  LIVEKIT_API_SECRET: 's',
};

describe('loadConfig uploadsDir', () => {
  it('defaults to uploads/ next to the database', () => {
    const config = loadConfig({ ...base, DATABASE_PATH: './var/db/app.db' });
    expect(config.uploadsDir).toBe(join(dirname('./var/db/app.db'), 'uploads'));
  });

  it('defaults next to the default database path', () => {
    expect(loadConfig(base).uploadsDir).toBe(join('data', 'uploads'));
  });

  it('honors UPLOADS_DIR', () => {
    const config = loadConfig({
      ...base,
      DATABASE_PATH: './var/db/app.db',
      UPLOADS_DIR: '/mnt/img',
    });
    expect(config.uploadsDir).toBe('/mnt/img');
  });
});
