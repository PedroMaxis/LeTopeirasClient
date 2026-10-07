import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import type { ApiError, HealthResponse } from '@letopeiras/shared';
import type { ServerConfig } from './config';
import type { Db } from './db';
import type { AppContext } from './http/context';
import { authRoutes } from './http/routes/auth';
import { channelRoutes } from './http/routes/channels';
import { userRoutes } from './http/routes/users';
import { voiceRoutes } from './http/routes/voice';
import { AppError } from './lib/errors';
import { createWebhookReceiver } from './services/livekit';
import { VoiceStateStore } from './services/voice-state';
import { Gateway } from './ws/gateway';

export interface AppOptions extends FastifyServerOptions {
  config: ServerConfig;
  db: Db;
}

const apiError = (code: string, message: string): ApiError => ({ error: { code, message } });

export function buildApp({ config, db, ...fastifyOptions }: AppOptions) {
  const app = Fastify({ bodyLimit: 64 * 1024, ...fastifyOptions });

  const voice = new VoiceStateStore();
  const gateway = new Gateway({ db, voice, log: app.log });
  const ctx: AppContext = {
    config,
    db,
    voice,
    gateway,
    webhookReceiver: createWebhookReceiver(config.livekit),
  };
  app.decorate('ctx', ctx);
  app.decorateRequest('auth', null);
  app.addHook('onClose', async () => gateway.close());

  // Auth is a bearer token, never a cookie, so reflecting any origin is safe.
  app.register(cors, { origin: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  app.register(websocket, { options: { maxPayload: 16 * 1024 } });

  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send(apiError(err.code, err.message));
    }
    // Fastify's own client errors: malformed JSON, body too large, wrong content type…
    if (err.statusCode !== undefined && err.statusCode < 500) {
      return reply.status(err.statusCode).send(apiError('bad_request', 'Requisição inválida'));
    }
    request.log.error(err);
    return reply.status(500).send(apiError('internal', 'Erro interno do servidor'));
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send(apiError('not_found', 'Rota não encontrada')),
  );

  app.get('/health', async (): Promise<HealthResponse> => {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  });

  app.register(async (scope) => {
    scope.get('/ws', { websocket: true }, (socket, request) => gateway.accept(socket, request.ip));
    authRoutes(scope, ctx);
    channelRoutes(scope, ctx);
    userRoutes(scope, ctx);
    voiceRoutes(scope, ctx);
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}
