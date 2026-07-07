import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { WhyRiskBriefRecord } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { BriefService } from './service.js';

/**
 * brief module — the per-PR Why+Risk Brief API.
 *
 *   GET  /pulls/:id/brief  → the stored brief + `is_stale` (0 LLM), or null
 *   POST /pulls/:id/brief  → generate/regenerate (exactly 1 LLM call)
 *
 * Both handlers call `getContext` (the AC-16 workspace guard) so a PR in another
 * workspace is invisible; the service resolves the PR workspace-scoped via
 * `reviewRepo.getPull(workspaceId, id)` and 404s a foreign/absent one — the
 * guard runs BEFORE any single-flight coalescing. Handlers are a thin edge
 * (onion rule 6): read context, call one service method, return its result — no
 * logic, no DB, no adapter access here.
 */

/** `/pulls/:id/...` addresses a PR row by uuid. */
const PrParams = z.object({ id: z.string().uuid() });

export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BriefService(app.container);

  app.get(
    '/pulls/:id/brief',
    { schema: { params: PrParams, response: { 200: WhyRiskBriefRecord.nullable() } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getBrief(workspaceId, req.params.id);
    },
  );

  app.post(
    '/pulls/:id/brief',
    { schema: { params: PrParams, response: { 200: WhyRiskBriefRecord } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.generate(workspaceId, req.params.id);
    },
  );
}
