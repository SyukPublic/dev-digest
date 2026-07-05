import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DiscoveredDocument, DocumentContent, ProjectContextConfig, SpecAttachment, SpecOwner } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ProjectContextService } from './service.js';

/**
 * project-context module — the producer side of the Project Context Folder.
 *
 *   GET  /repos/:repoId/project-context          → discover markdown docs
 *   GET  /repos/:repoId/project-context/content  → one doc's raw content + tokens
 *   GET  /agents/:id/specs   POST /agents/:id/specs   → attached docs (ordered)
 *   GET  /skills/:id/specs   POST /skills/:id/specs   → attached docs (ordered)
 *
 * Every handler calls `getContext` (the AC-20 workspace guard) so a repo /
 * agent / skill in another workspace is invisible. Response shapes come from the
 * shared `@devdigest/shared` contracts (Phase 2): `DiscoveredDocument`,
 * `DocumentContent`, `SpecAttachment`.
 *
 * The attach endpoints take the FULL ordered set of paths (`{ paths }`) and
 * apply delete-all-then-insert semantics (like `setSkills`); every path is
 * traversal-validated in the service before it is persisted (AC-22).
 */

/** `/repos/:repoId/...` addresses a repo row by uuid. */
const RepoParams = z.object({ repoId: z.string().uuid() });

/** `?path=` selects a discovered doc (repo-relative). Non-empty. */
const ContentQuery = z.object({ path: z.string().min(1) });

/**
 * Optional owner selector on the discover endpoint (FIX 3b / AC-15). When
 * present, the service ALSO returns synthesized `missing: true` rows for that
 * owner's attached paths that no longer resolve on the clone. Absent → the
 * owner-LESS path (present docs only), byte-identical to prior behavior.
 * `owner` + `ownerId` are supplied together.
 */
const DiscoverQuery = z.object({
  owner: SpecOwner.optional(),
  ownerId: z.string().uuid().optional(),
});

/** POST body for the attach endpoints: the FULL ordered set of doc paths. */
const SetSpecsBody = z.object({ paths: z.array(z.string().min(1)) });

/** Ordered attachment list response ({ path, order }[]). */
const SpecAttachmentList = z.array(SpecAttachment);

export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ProjectContextService(app.container);

  // ---- Discover / preview (Phase 1) ---------------------------------------

  app.get(
    '/repos/:repoId/project-context',
    {
      schema: {
        params: RepoParams,
        querystring: DiscoverQuery,
        response: { 200: z.array(DiscoveredDocument) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const { owner, ownerId } = req.query;
      // Owner-aware discovery (AC-15): only when BOTH are supplied — otherwise
      // the owner-less path (present docs only) is returned unchanged.
      const forOwner = owner && ownerId ? { owner, ownerId } : undefined;
      return service.discover(workspaceId, req.params.repoId, forOwner);
    },
  );

  app.get(
    '/repos/:repoId/project-context/config',
    { schema: { params: RepoParams, response: { 200: ProjectContextConfig } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.config(workspaceId, req.params.repoId);
    },
  );

  app.get(
    '/repos/:repoId/project-context/content',
    { schema: { params: RepoParams, querystring: ContentQuery, response: { 200: DocumentContent } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.content(workspaceId, req.params.repoId, req.query.path);
    },
  );

  // ---- Attach on an agent -------------------------------------------------

  app.get(
    '/agents/:id/specs',
    { schema: { params: IdParams, response: { 200: SpecAttachmentList } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.agentSpecs(workspaceId, req.params.id);
    },
  );

  app.post(
    '/agents/:id/specs',
    { schema: { params: IdParams, body: SetSpecsBody, response: { 200: SpecAttachmentList } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.setAgentSpecs(workspaceId, req.params.id, req.body.paths);
    },
  );

  // ---- Attach on a skill --------------------------------------------------

  app.get(
    '/skills/:id/specs',
    { schema: { params: IdParams, response: { 200: SpecAttachmentList } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.skillSpecs(workspaceId, req.params.id);
    },
  );

  app.post(
    '/skills/:id/specs',
    { schema: { params: IdParams, body: SetSpecsBody, response: { 200: SpecAttachmentList } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.setSkillSpecs(workspaceId, req.params.id, req.body.paths);
    },
  );
}
