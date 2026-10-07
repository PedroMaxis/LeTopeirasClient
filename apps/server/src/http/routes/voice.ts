import { voiceTokenRequestSchema, type VoiceTokenResponse } from '@letopeiras/shared';
import type { FastifyInstance } from 'fastify';
import type { WebhookEvent } from 'livekit-server-sdk';
import { badRequest, unauthorized } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAccess } from '../../services/access';
import { applyWebhookEvent, createVoiceToken, voiceFilter } from '../../services/livekit';
import { getAuth, requireAuth, type AppContext } from '../context';

export function voiceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config, voice, gateway, webhookReceiver } = ctx;
  const filter = voiceFilter(db);

  app.post(
    '/voice/token',
    { preHandler: requireAuth(db) },
    async (request): Promise<VoiceTokenResponse> => {
      const { user } = getAuth(request);
      const { channelId } = parse(voiceTokenRequestSchema, request.body);
      const channel = requireAccess(db, user, channelId);
      if (channel.type !== 'voice')
        throw badRequest('Esse canal não é de voz', 'not_voice_channel');
      return {
        url: config.livekit.url,
        token: await createVoiceToken(config.livekit, user, channelId),
      };
    },
  );

  // LiveKit signs the raw body, so this route gets it as a string.
  app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/webhook+json',
      { parseAs: 'string' },
      (_request, body, done) => done(null, body),
    );

    scope.post('/livekit/webhook', async (request, reply) => {
      if (typeof request.body !== 'string') throw badRequest('Corpo inválido');
      let event: WebhookEvent;
      try {
        event = await webhookReceiver.receive(request.body, request.headers.authorization);
      } catch {
        throw unauthorized('Assinatura do webhook inválida');
      }
      gateway.broadcastVoice(applyWebhookEvent(voice, event, filter));
      return reply.status(200).send();
    });
  });
}
