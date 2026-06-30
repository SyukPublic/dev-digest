import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BlastResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * blast module.
 *   GET /pulls/:id/blast → deterministic blast-radius impact map (read from the
 *                          repo-intel index) + index status badge + a cached,
 *                          best-effort one-paragraph prose summary.
 *
 * Onion: a thin edge — read context, parse the param via IdParams, call ONE
 * service method, return its result. NO rate limit: the map is a deterministic
 * Postgres read and the LLM call is cached + best-effort (never the request's
 * hot path in the steady state).
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BlastService(container);

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams, response: { 200: BlastResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getBlast(workspaceId, req.params.id);
    },
  );
}
