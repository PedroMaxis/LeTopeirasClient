import { buildApp } from './app';
import { loadConfig } from './config';
import { openDatabase } from './db';
import { deleteExpiredSessions } from './repo/sessions';
import { syncVoiceState, voiceFilter } from './services/livekit';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const app = buildApp({
  config,
  db,
  logger: { level: config.logLevel },
  trustProxy: config.trustProxy,
});

const cleanup = setInterval(() => deleteExpiredSessions(db), 60 * 60 * 1000);
cleanup.unref();

const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down`);
  clearInterval(cleanup);
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Webhooks sent while we were down are lost; rebuild who is in voice from LiveKit.
try {
  const { voice, gateway } = app.ctx;
  gateway.broadcastVoice(await syncVoiceState(config.livekit, voice, voiceFilter(db)));
} catch (err) {
  app.log.warn({ err }, 'Could not sync voice state from LiveKit');
}
