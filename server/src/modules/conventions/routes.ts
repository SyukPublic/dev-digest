import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

/**
 * Conventions Extractor — transport layer only.
 *   POST  /repos/:id/conventions/extract   → enqueue a scan/re-scan (202 + jobId)
 *   GET   /repos/:id/conventions           → list candidates (workspace-scoped)
 *   PATCH /repos/:id/conventions/:cid      → accept/reject + inline edit
 *
 * Job-handler registration lives here (runs once at boot), mirroring
 * `RepoService.registerCloneJobHandler` / repo-intel's index handlers.
 */

/** `/repos/:id/conventions/:cid` — both ids are uuids. */
const ConventionParams = z.object({ id: z.string().uuid(), cid: z.string().uuid() });

const UpdateConventionBody = z.object({
  accepted: z.boolean().optional(),
  rule: z.string().min(1).optional(),
  evidence_path: z.string().optional(),
  evidence_snippet: z.string().optional(),
  category: z.string().optional(),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);
  service.registerExtractJobHandler();

  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: IdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const jobId = await service.enqueueExtract(workspaceId, req.params.id);
      reply.code(202);
      return { status: 'accepted', jobId };
    },
  );

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.patch(
    '/repos/:id/conventions/:cid',
    { schema: { params: ConventionParams, body: UpdateConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const b = req.body;
      const updated = await service.update(workspaceId, req.params.cid, {
        ...(b.accepted !== undefined ? { accepted: b.accepted } : {}),
        ...(b.rule !== undefined ? { rule: b.rule } : {}),
        ...(b.evidence_path !== undefined ? { evidencePath: b.evidence_path } : {}),
        ...(b.evidence_snippet !== undefined ? { evidenceSnippet: b.evidence_snippet } : {}),
        ...(b.category !== undefined ? { category: b.category } : {}),
      });
      if (!updated) throw new NotFoundError('Convention not found');
      return updated;
    },
  );
}
