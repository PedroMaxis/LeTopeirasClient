import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import { LIMITS, type ApiError, type HealthResponse } from '@letopeiras/shared';
import type { ServerConfig } from './config';
import type { Db } from './db';
import type { AppContext } from './http/context';
import { authRoutes } from './http/routes/auth';
import { channelRoutes } from './http/routes/channels';
import { fileRoutes } from './http/routes/files';
import { musicRoutes } from './http/routes/music';
import { userRoutes } from './http/routes/users';
import { voiceRoutes } from './http/routes/voice';
import { AppError } from './lib/errors';
import { findChannel } from './repo/channels';
import { EmbedService, type PreviewFetcher } from './services/embeds';
import { FileStore } from './services/files';
import { fetchPreview } from './services/link-preview';
import { createWebhookReceiver } from './services/livekit';
import { MusicStore } from './services/music';
import { VoiceStateStore } from './services/voice-state';
import { fetchJson, YouTubeService, type JsonFetcher } from './services/youtube';
import { Gateway } from './ws/gateway';

export interface AppOptions extends FastifyServerOptions {
  config: ServerConfig;
  db: Db;
  /** Replaces the network fetch of link previews (tests). */
  fetchPreview?: PreviewFetcher;
  /** Replaces the network calls of music search (tests). */
  fetchJson?: JsonFetcher;
}

const apiError = (code: string, message: string): ApiError => ({ error: { code, message } });

export function buildApp({
  config,
  db,
  fetchPreview: fetcher,
  fetchJson: jsonFetcher,
  ...fastifyOptions
}: AppOptions) {
  const app = Fastify({ bodyLimit: 64 * 1024, ...fastifyOptions });

  const voice = new VoiceStateStore();
  const files = new FileStore(config.uploadsDir);
  const youtube = new YouTubeService({
    apiKey: config.youtubeApiKey,
    fetchJson: jsonFetcher ?? fetchJson,
  });
  const music: MusicStore = new MusicStore({
    onChange: (channelId) => gateway.broadcastMusic(channelId),
    onFailed: (channelId, track) => gateway.broadcastMusicFailed(channelId, track.title),
  });
  const gateway: Gateway = new Gateway({
    db,
    voice,
    music,
    youtube,
    log: app.log,
    onMessageSaved: (message) => embeds.schedule(message),
    onFilesReleased: (hashes) =>
      void files
        .collect(db, hashes)
        .catch((err: unknown) => app.log.error({ err }, 'Could not remove an image file')),
  });
  const embeds = new EmbedService({
    db,
    fetchPreview: fetcher ?? fetchPreview,
    log: app.log,
    onUpdated: (message) => {
      const channel = findChannel(db, message.channelId);
      if (channel)
        gateway.broadcastToChannel(channel, { type: 'message.updated', data: { message } });
    },
  });
  // Hourly cleanup of uploads never sent and files nobody uses, plus once at startup.
  const sweep = () =>
    void files.sweep(db).catch((err: unknown) => app.log.error({ err }, 'Upload sweep failed'));
  const sweepTimer = setInterval(sweep, 60 * 60 * 1000);
  sweepTimer.unref();
  app.addHook('onReady', async () => sweep());

  const ctx: AppContext = {
    config,
    db,
    voice,
    music,
    youtube,
    gateway,
    embeds,
    files,
    webhookReceiver: createWebhookReceiver(config.livekit),
  };
  app.decorate('ctx', ctx);
  app.decorateRequest('auth', null);
  app.addHook('onClose', async () => {
    clearInterval(sweepTimer);
    embeds.close();
    music.close();
    gateway.close();
  });

  // Auth is a bearer token, never a cookie, so reflecting any origin is safe.
  app.register(cors, { origin: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  app.register(websocket, { options: { maxPayload: 16 * 1024 } });
  // Per-route limits (10 MB chat, 25 MB avatar) are checked where the file is read.
  app.register(multipart, {
    limits: { fileSize: LIMITS.avatarMaxBytes, files: 1, fields: 0, parts: 1 },
  });

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
    musicRoutes(scope, ctx);
    fileRoutes(scope, ctx);
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}
