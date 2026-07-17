import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AgentPerf, AgentStats, SkillStats } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { StatsService } from './service.js';
import { PeriodQuery } from './schemas.js';

/**
 * Stats module (read-only analytics; L08).
 *   GET /agents/performance   → AgentPerf   (the global dashboard)
 *   GET /agents/:id/stats     → AgentStats  (per-agent Stats tab)
 *   GET /skills/:id/stats     → SkillStats  (per-skill Stats tab)
 *
 * Thin edge: read workspace context, parse `PeriodQuery` (querystring) + `IdParams`
 * at the boundary (bad range/ISO → 422 before any aggregation, AC-4), call ONE
 * service method, return the Zod-serialized DTO. `/agents/performance` is a STATIC
 * segment, so find-my-way resolves it before the agents module's `/agents/:id`
 * param route.
 */
export default async function statsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new StatsService(app.container);

  app.get(
    '/agents/performance',
    { schema: { querystring: PeriodQuery, response: { 200: AgentPerf } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.agentPerformance(workspaceId, req.query);
    },
  );

  app.get(
    '/agents/:id/stats',
    { schema: { params: IdParams, querystring: PeriodQuery, response: { 200: AgentStats } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const stats = await service.agentStats(workspaceId, req.params.id, req.query);
      if (stats === undefined) throw new NotFoundError('Agent not found');
      return stats;
    },
  );

  app.get(
    '/skills/:id/stats',
    { schema: { params: IdParams, querystring: PeriodQuery, response: { 200: SkillStats } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const stats = await service.skillStats(workspaceId, req.params.id, req.query);
      if (stats === undefined) throw new NotFoundError('Skill not found');
      return stats;
    },
  );
}
