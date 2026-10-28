import { LIMITS, type MusicSearchResponse } from '@letopeiras/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tooManyRequests } from '../../lib/errors';
import { RateLimiter } from '../../lib/rate-limit';
import { parse } from '../../lib/validate';
import { getAuth, requireAuth, type AppContext } from '../context';

const searchQuery = z.object({ q: z.string().trim().min(1).max(LIMITS.musicSearchMax) });

export function musicRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, youtube } = ctx;
  // Each text search spends a hundredth of the day's YouTube quota.
  const limiter = new RateLimiter(10, 60_000);

  app.get(
    '/music/search',
    { preHandler: requireAuth(db) },
    async (request): Promise<MusicSearchResponse> => {
      const { user } = getAuth(request);
      const { q } = parse(searchQuery, request.query);
      if (!limiter.consume(String(user.id))) throw tooManyRequests();
      return { results: await youtube.search(q) };
    },
  );
}
