import {
  createCategoryRequestSchema,
  createChannelRequestSchema,
  idSchema,
  messageHistoryQuerySchema,
  updateCategoryRequestSchema,
  updateChannelRequestSchema,
  type Category,
  type Channel,
  type MessageHistoryResponse,
} from '@letopeiras/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db';
import { badRequest, notFound } from '../../lib/errors';
import { parse } from '../../lib/validate';
import {
  createCategory,
  deleteCategory,
  findCategory,
  updateCategory,
} from '../../repo/categories';
import { createChannel, deleteChannel, findChannel, updateChannel } from '../../repo/channels';
import { messageHistory } from '../../services/messages';
import { getAdmin, getAuth, requireAuth, type AppContext } from '../context';
import { applyPermissionChange } from '../permissions';

const idParamsSchema = z.object({ id: z.coerce.number().pipe(idSchema) });

function assertCategory(db: Db, categoryId: number | null | undefined): void {
  if (categoryId != null && !findCategory(db, categoryId)) {
    throw badRequest('Categoria não encontrada', 'unknown_category');
  }
}

export function channelRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, gateway, voice } = ctx;
  const preHandler = requireAuth(db);

  app.post('/channels', { preHandler }, async (request, reply): Promise<Channel> => {
    getAdmin(request);
    const input = parse(createChannelRequestSchema, request.body);
    assertCategory(db, input.categoryId);
    const channel = createChannel(db, input);
    gateway.broadcastChannel('channel.created', channel);
    reply.status(201);
    return channel;
  });

  app.patch('/channels/:id', { preHandler }, async (request): Promise<Channel> => {
    getAdmin(request);
    const { id } = parse(idParamsSchema, request.params);
    const changes = parse(updateChannelRequestSchema, request.body);
    assertCategory(db, changes.categoryId);
    const before = findChannel(db, id);
    const channel = updateChannel(db, id, changes);
    if (!before || !channel) throw notFound('Canal não encontrado');

    const accessChanged =
      before.isPrivate !== channel.isPrivate || before.roleIds.join() !== channel.roleIds.join();
    if (accessChanged) applyPermissionChange(ctx, request.log);
    else gateway.broadcastChannel('channel.updated', channel);
    return channel;
  });

  app.delete('/channels/:id', { preHandler }, async (request, reply) => {
    getAdmin(request);
    const { id } = parse(idParamsSchema, request.params);
    if (!deleteChannel(db, id)) throw notFound('Canal não encontrado');
    // Webhooks for this room are ignored from now on; drop whoever was in it.
    voice.clearChannel(id);
    gateway.broadcast({ type: 'channel.deleted', data: { channelId: id } });
    return reply.status(204).send();
  });

  app.get(
    '/channels/:id/messages',
    { preHandler },
    async (request): Promise<MessageHistoryResponse> => {
      const { user } = getAuth(request);
      const { id } = parse(idParamsSchema, request.params);
      return messageHistory(db, user, id, parse(messageHistoryQuerySchema, request.query));
    },
  );

  // ---------------------------------------------------------------- categories

  app.post('/categories', { preHandler }, async (request, reply): Promise<Category> => {
    getAdmin(request);
    const { name } = parse(createCategoryRequestSchema, request.body);
    const category = createCategory(db, name);
    gateway.broadcast({ type: 'category.created', data: { category } });
    reply.status(201);
    return category;
  });

  app.patch('/categories/:id', { preHandler }, async (request): Promise<Category> => {
    getAdmin(request);
    const { id } = parse(idParamsSchema, request.params);
    const category = updateCategory(db, id, parse(updateCategoryRequestSchema, request.body));
    if (!category) throw notFound('Categoria não encontrada');
    gateway.broadcast({ type: 'category.updated', data: { category } });
    return category;
  });

  app.delete('/categories/:id', { preHandler }, async (request, reply) => {
    getAdmin(request);
    const { id } = parse(idParamsSchema, request.params);
    if (!deleteCategory(db, id)) throw notFound('Categoria não encontrada');
    // Its channels moved to "no category"; everyone needs their new categoryId.
    gateway.resync();
    return reply.status(204).send();
  });
}
