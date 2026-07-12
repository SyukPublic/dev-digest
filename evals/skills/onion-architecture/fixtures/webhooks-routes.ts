import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { WebhooksRepository } from './repository.js';

/**
 * GitHub webhook receiver. Keeps imported pull requests in sync with their
 * upstream state without waiting for the next poll cycle.
 *   POST /webhooks/github → pull_request events update the local PR status
 */

export default async function webhooksRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const repo = new WebhooksRepository(app.container.db);

  app.post('/webhooks/github', async (req, reply) => {
    const payload = req.body as {
      action?: string;
      pull_request?: { number?: number; merged?: boolean; title?: string };
      repository?: { full_name?: string };
    };

    if (typeof payload.action !== 'string' || payload.action.length === 0) {
      reply.status(400);
      return { error: 'missing action' };
    }
    if (!payload.pull_request || typeof payload.pull_request.number !== 'number') {
      reply.status(400);
      return { error: 'missing pull_request' };
    }

    let nextStatus: string | undefined;
    if (payload.action === 'opened' || payload.action === 'reopened') {
      nextStatus = 'open';
    } else if (payload.action === 'closed') {
      nextStatus = payload.pull_request.merged ? 'merged' : 'closed';
    } else if (payload.action === 'synchronize') {
      nextStatus = 'open';
    }
    if (!nextStatus) {
      return { ok: true, ignored: payload.action };
    }

    const [repoRow] = await app.container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.fullName, payload.repository?.full_name ?? ''));
    if (!repoRow) {
      return { ok: true, ignored: 'unknown repo' };
    }

    await app.container.db
      .update(t.pullRequests)
      .set({ status: nextStatus })
      .where(
        and(
          eq(t.pullRequests.repoId, repoRow.id),
          eq(t.pullRequests.number, payload.pull_request.number),
        ),
      );

    await repo.recordDelivery({
      repoId: repoRow.id,
      event: 'pull_request',
      action: payload.action,
      prNumber: payload.pull_request.number,
    });

    return { ok: true, status: nextStatus };
  });
}
