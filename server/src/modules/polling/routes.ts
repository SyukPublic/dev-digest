import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { PollingService } from './service.js';

/**
 * F1 — polling module. Transport layer only: parses the request and delegates
 * to PollingService.
 *
 *   POST /repos/:id/poll  → sync PR list from GitHub, bump last_polled_at
 */
const PollResult = z.object({
  synced: z.number().int(),
  reviewTriggered: z.literal(false),
});

export default async function pollingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new PollingService(app.container);

  app.post(
    '/repos/:id/poll',
    { schema: { params: IdParams, response: { 200: PollResult } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.poll(workspaceId, req.params.id, req.log);
    },
  );
}
