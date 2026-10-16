import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { LIMITS, type Attachment, type User } from '@letopeiras/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { expectRow } from '../../db';
import { AppError, badRequest, notFound, tooManyRequests } from '../../lib/errors';
import { RateLimiter } from '../../lib/rate-limit';
import { createAttachment } from '../../repo/attachments';
import { findUserById, updateAvatarUrl } from '../../repo/users';
import { fileUrl, hashFromUrl, isHash } from '../../services/files';
import { toAvatar, toChatImage } from '../../services/images';
import { getAuth, requireAuth, type AppContext } from '../context';

/** The single `file` field of a multipart request, read into memory up to `maxBytes`. */
async function readFile(
  request: FastifyRequest,
  maxBytes: number,
  tooLarge: string,
): Promise<Buffer> {
  const part = await request
    .file({ limits: { fileSize: maxBytes, files: 1 } })
    .catch(() => undefined);
  if (!part) throw badRequest('Nenhum arquivo enviado', 'no_file');
  try {
    return await part.toBuffer();
  } catch (err) {
    if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      throw new AppError(413, 'file_too_large', tooLarge);
    }
    throw err;
  }
}

/** Image uploads (chat and avatar) and serving the stored files. */
export function fileRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, files, gateway } = ctx;
  const preHandler = requireAuth(db);
  // Compressing is the most CPU-heavy thing the server does; keep it bounded per person.
  const limiter = new RateLimiter(30, 60_000);
  const limit = (userId: number) => {
    if (!limiter.consume(String(userId))) throw tooManyRequests();
  };

  app.post('/uploads', { preHandler }, async (request, reply): Promise<Attachment> => {
    const { user } = getAuth(request);
    limit(user.id);
    const input = await readFile(
      request,
      LIMITS.attachmentMaxBytes,
      'Cada imagem pode ter até 10 MB',
    );
    const image = await toChatImage(input);
    const hash = await files.save(image.data);
    reply.status(201);
    return createAttachment(db, {
      uploaderId: user.id,
      hash,
      width: image.width,
      height: image.height,
      size: image.data.length,
    });
  });

  // Public on purpose: <img> can't send our bearer token, and the hash can't be guessed.
  app.get('/files/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const hash = name.endsWith('.webp') ? name.slice(0, -5) : '';
    if (!isHash(hash)) throw notFound();
    const path = files.pathOf(hash);
    const info = await stat(path).catch(() => null);
    if (!info) throw notFound();
    return reply
      .header('content-type', 'image/webp')
      .header('content-length', info.size)
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .send(createReadStream(path));
  });

  /** Points the user's avatar at `url`, then drops the file it replaced if nothing else uses it. */
  const changeAvatar = async (userId: number, url: string | null): Promise<User> => {
    const previous = hashFromUrl(expectRow(findUserById(db, userId)).avatarUrl);
    updateAvatarUrl(db, userId, url);
    const updated = expectRow(findUserById(db, userId));
    gateway.refreshUser(updated);
    gateway.broadcast({ type: 'user.updated', data: { user: updated } });
    if (previous) await files.collect(db, [previous]);
    return updated;
  };

  app.put('/users/me/avatar', { preHandler }, async (request): Promise<User> => {
    const { user } = getAuth(request);
    limit(user.id);
    const input = await readFile(request, LIMITS.avatarMaxBytes, 'A foto pode ter até 25 MB');
    const hash = await files.save(await toAvatar(input));
    return changeAvatar(user.id, fileUrl(hash));
  });

  app.delete('/users/me/avatar', { preHandler }, async (request): Promise<User> => {
    return changeAvatar(getAuth(request).user.id, null);
  });
}
