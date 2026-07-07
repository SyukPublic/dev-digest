import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { OnboardingTourResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { OnboardingGeneratorService } from './service.js';

/**
 * onboarding-generator module — the per-repo Onboarding Tour API.
 *
 *   GET  /repos/:repoId/onboarding-tour           → the stored tour + meta (0 LLM)
 *   POST /repos/:repoId/onboarding-tour/generate  → generate/regenerate (1 LLM call)
 *
 * Both handlers call `getContext` (the AC-20 workspace guard) so a repo in
 * another workspace is invisible; the service resolves the repo workspace-scoped
 * via `reposRepo.getById(workspaceId, repoId)` and 404s a foreign/absent one.
 * Handlers are a thin edge (onion rule 6): read context, call one service method,
 * return its result — no logic, no DB, no adapter access here.
 */

/** `/repos/:repoId/...` addresses a repo row by uuid. */
const RepoParams = z.object({ repoId: z.string().uuid() });

export default async function onboardingGeneratorRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new OnboardingGeneratorService(app.container);

  app.get(
    '/repos/:repoId/onboarding-tour',
    { schema: { params: RepoParams, response: { 200: OnboardingTourResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getTour(workspaceId, req.params.repoId);
    },
  );

  app.post(
    '/repos/:repoId/onboarding-tour/generate',
    { schema: { params: RepoParams, response: { 200: OnboardingTourResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.generate(workspaceId, req.params.repoId);
    },
  );
}
