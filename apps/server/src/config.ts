import { z } from 'zod';

export const DEFAULT_DATABASE_PATH = './data/letopeiras.db';

const envSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().min(1).default(DEFAULT_DATABASE_PATH),
  /** Set when running behind Caddy so request.ip is the real client address. */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Public LiveKit URL handed to clients, e.g. wss://letopeiras-lk.duckdns.org */
  LIVEKIT_URL: z.string().url(),
  /** URL the server uses for the LiveKit API, e.g. http://livekit:7880 inside Docker. */
  LIVEKIT_API_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface ServerConfig {
  host: string;
  port: number;
  databasePath: string;
  trustProxy: boolean;
  livekit: { url: string; apiUrl: string; apiKey: string; apiSecret: string };
  sessionTtlMs: number;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${issues.join('\n')}`);
  }
  const e = result.data;
  return {
    host: e.HOST,
    port: e.PORT,
    databasePath: e.DATABASE_PATH,
    trustProxy: e.TRUST_PROXY,
    livekit: {
      url: e.LIVEKIT_URL,
      apiUrl: e.LIVEKIT_API_URL,
      apiKey: e.LIVEKIT_API_KEY,
      apiSecret: e.LIVEKIT_API_SECRET,
    },
    sessionTtlMs: e.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    logLevel: e.LOG_LEVEL,
  };
}
