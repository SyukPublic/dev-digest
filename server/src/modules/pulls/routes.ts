import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PrMeta, PrDetail, PrReviewComment, PrCommentInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { PullsService } from './service.js';

/**
 * F1 — pulls module. Transport layer only: parses requests and delegates to
 * PullsService. PR import via Octokit (list + per-PR detail); inline comments
 * proxied live to GitHub.
 *
 *   GET  /repos/:id/pulls    → list PRs for a repo (synced from GitHub, persisted)
 *   GET  /pulls/:id          → full PR detail (diff/files, commits, body)
 *   GET  /pulls/:id/comments → inline review comments (Files changed tab)
 *   POST /pulls/:id/comments → create one inline review comment / reply
 *
 * Import is idempotent (unique repo_id+number). Review trigger is MANUAL and
 * owned by A2 — this module only imports/reads.
 */
/**
 * Optional `?number=<n>` filter on the PR-list route. Query params arrive as
 * strings, so coerce to a positive integer. When present, the route resolves the
 * single matching PR (local read, no GitHub sync); when absent, the full list is
 * returned. The response stays `PrMeta[]` either way (0 or 1 element when
 * filtered) to keep one stable contract.
 */
const PullsQuery = z.object({
  number: z.coerce.number().int().positive().optional(),
});

export default async function pullsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new PullsService(app.container);

  app.get(
    '/repos/:id/pulls',
    { schema: { params: IdParams, querystring: PullsQuery, response: { 200: z.array(PrMeta) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      if (req.query.number !== undefined) {
        const pr = await service.getByNumber(workspaceId, req.params.id, req.query.number);
        return pr ? [pr] : [];
      }
      return service.listPulls(workspaceId, req.params.id, req.log);
    },
  );

  app.get(
    '/pulls/:id',
    { schema: { params: IdParams, response: { 200: PrDetail } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getDetail(workspaceId, req.params.id, req.log);
    },
  );

  app.get(
    '/pulls/:id/comments',
    { schema: { params: IdParams, response: { 200: z.array(PrReviewComment) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listComments(workspaceId, req.params.id, req.log);
    },
  );

  app.post(
    '/pulls/:id/comments',
    { schema: { params: IdParams, body: PrCommentInput, response: { 200: PrReviewComment } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.createComment(workspaceId, req.params.id, req.body);
    },
  );
}
