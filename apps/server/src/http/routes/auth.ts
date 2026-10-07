import {
  createInviteRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  type AuthResponse,
  type InviteResponse,
} from '@letopeiras/shared';
import type { FastifyInstance } from 'fastify';
import { tooManyRequests } from '../../lib/errors';
import { RateLimiter } from '../../lib/rate-limit';
import { parse } from '../../lib/validate';
import { createInvite } from '../../repo/invites';
import { deleteSession } from '../../repo/sessions';
import { login, register } from '../../services/auth';
import { getAdmin, getAuth, requireAuth, type AppContext } from '../context';

const HOUR_MS = 60 * 60 * 1000;

export function authRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config, gateway } = ctx;
  const loginLimiter = new RateLimiter(10, 15 * 60 * 1000);
  const registerLimiter = new RateLimiter(10, HOUR_MS);

  app.post('/auth/register', async (request, reply): Promise<AuthResponse> => {
    if (!registerLimiter.consume(request.ip)) throw tooManyRequests();
    const input = parse(registerRequestSchema, request.body);
    const result = await register(db, input, config.sessionTtlMs);
    gateway.broadcast({ type: 'user.created', data: { user: result.user } });
    reply.status(201);
    return result;
  });

  app.post('/auth/login', async (request): Promise<AuthResponse> => {
    if (!loginLimiter.consume(request.ip)) throw tooManyRequests();
    const input = parse(loginRequestSchema, request.body);
    return login(db, input, config.sessionTtlMs);
  });

  app.post('/auth/logout', { preHandler: requireAuth(db) }, async (request, reply) => {
    const { session } = getAuth(request);
    deleteSession(db, session.id);
    gateway.closeSession(session.id);
    return reply.status(204).send();
  });

  app.post(
    '/invites',
    { preHandler: requireAuth(db) },
    async (request, reply): Promise<InviteResponse> => {
      const { user } = getAdmin(request);
      const { expiresInHours } = parse(createInviteRequestSchema, request.body ?? {});
      reply.status(201);
      return createInvite(db, user.id, expiresInHours * HOUR_MS);
    },
  );
}
