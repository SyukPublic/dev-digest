import type { FastifyInstance } from 'fastify';
import { getContext } from '../_shared/context.js';
import { WorkspaceService } from './service.js';

/**
 * F1 — workspace manager: where clones live + a summary of cloned repos.
 * Transport layer only: delegates to WorkspaceService.
 *   GET /workspace → workspace info + cloneDir + cloned repos summary
 */
export default async function workspaceRoutes(app: FastifyInstance) {
  const service = new WorkspaceService(app.container);

  app.get('/workspace', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getOverview(workspaceId);
  });
}
