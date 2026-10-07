import type { FastifyReply, FastifyRequest } from 'fastify';
import type { WebhookReceiver } from 'livekit-server-sdk';
import type { ServerConfig } from '../config';
import type { Db } from '../db';
import { forbidden, unauthorized } from '../lib/errors';
import { authenticate, type AuthContext } from '../services/auth';
import type { VoiceStateStore } from '../services/voice-state';
import type { Gateway } from '../ws/gateway';

/** Everything the route modules need, created once per app in buildApp. */
export interface AppContext {
  config: ServerConfig;
  db: Db;
  voice: VoiceStateStore;
  gateway: Gateway;
  webhookReceiver: WebhookReceiver;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

const bearerToken = (request: FastifyRequest): string | undefined => {
  const header = request.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
};

/** preHandler that rejects requests without a valid `Authorization: Bearer <token>`. */
export const requireAuth =
  (db: Db) =>
  async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const token = bearerToken(request);
    const auth = token ? authenticate(db, token) : undefined;
    if (!auth) throw unauthorized();
    request.auth = auth;
  };

/** The authenticated context. Only call from routes behind `requireAuth`. */
export function getAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthorized();
  return request.auth;
}

export function getAdmin(request: FastifyRequest): AuthContext {
  const auth = getAuth(request);
  if (!auth.user.isAdmin) throw forbidden();
  return auth;
}
