import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CiExportRequest } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { CiService } from './service.js';

/**
 * Export-to-CI module (L07).
 *   POST /agents/:id/export-ci        → serialize + open the CI PR (or preview files)
 *   GET  /agents/:id/ci-runs          → CI run history for one agent
 *   GET  /agents/:id/ci-installations → per-repo installations (CI tab)
 *   GET  /ci-runs                     → workspace CI runs (filters)
 *   POST /ci-runs/ingest              → pull-on-refresh ingest from GitHub Actions
 *
 * Thin edge: read context, parse the request with a shared contract, call ONE
 * service method, return its result.
 */

/** Filters for the CI Runs page (AC-35). `days` = the lookback window (default 7). */
const CiRunsQuery = z.object({
  days: z.coerce.number().int().positive().max(365).default(7),
  agent_id: z.string().uuid().optional(),
  repo: z.string().optional(),
  status: z.string().optional(),
  source: z.string().optional(),
});

export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new CiService(app.container);

  app.post(
    '/agents/:id/export-ci',
    { schema: { params: IdParams, body: CiExportRequest } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.export(workspaceId, req.params.id, req.body);
    },
  );

  app.get('/agents/:id/ci-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const runs = await service.listAgentCiRuns(workspaceId, req.params.id);
    if (runs === undefined) throw new NotFoundError('Agent not found');
    return runs;
  });

  app.get('/agents/:id/ci-installations', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const installations = await service.listInstallations(workspaceId, req.params.id);
    if (installations === undefined) throw new NotFoundError('Agent not found');
    return installations;
  });

  app.get('/ci-runs', { schema: { querystring: CiRunsQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const q = req.query;
    const since = new Date(Date.now() - q.days * 24 * 60 * 60 * 1000);
    return service.listCiRuns(workspaceId, {
      since,
      ...(q.agent_id !== undefined ? { agentId: q.agent_id } : {}),
      ...(q.repo !== undefined ? { repo: q.repo } : {}),
      ...(q.status !== undefined ? { status: q.status } : {}),
      ...(q.source !== undefined ? { source: q.source } : {}),
    });
  });

  app.post('/ci-runs/ingest', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.ingest(workspaceId);
  });
}
