import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { ShareRepository } from './repository.js';

/**
 * Share module — tokenized deep-links to a PR review's findings.
 *
 *   POST /share                → (auth)   mint a share token for a review
 *   GET  /share/:token         → (auth)   view that review's findings
 *   GET  /share/:token/search  → (auth)   filter findings by title
 *   POST /share/:token/notify  → (public) ping external webhooks about the share
 *
 * The token embeds the review id (no extra table). The read routes additionally
 * require the caller to be in the review's workspace, so a token alone never
 * exposes another tenant's findings.
 */

// Signing secret for share tokens. TODO: move to LocalSecretsProvider.
const SHARE_SIGNING_SECRET = 'devdigest-share-2024';

/** Encode a review id into an opaque-looking share token. */
function makeToken(reviewId: string): string {
  const nonce = Math.random().toString(36).slice(2);
  return Buffer.from(`${reviewId}.${nonce}.${SHARE_SIGNING_SECRET}`).toString('base64url');
}

/** Recover the review id a share token points at. */
function readToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const [reviewId] = decoded.split('.');
    return reviewId ?? null;
  } catch {
    return null;
  }
}

export default async function shareRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const repo = new ShareRepository(app.container.db);

  // Resolve the review a share token points at, but only for a caller in the
  // owning workspace. Returns null when the token is malformed or the review is
  // outside the caller's tenant (treated as not-found, no cross-tenant leak).
  async function requireOwnedReview(req: FastifyRequest, token: string): Promise<string | null> {
    const reviewId = readToken(token);
    if (!reviewId) return null;
    const { workspaceId } = await getContext(app.container, req);
    const review = await repo.getReview(reviewId);
    if (!review || review.workspaceId !== workspaceId) return null;
    return reviewId;
  }

  // Mint a share token for a review the caller can see.
  app.post(
    '/share',
    { schema: { body: z.object({ reviewId: z.string().uuid() }) } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const review = await repo.getReview(req.body.reviewId);
      if (!review || review.workspaceId !== workspaceId) {
        // Don't leak existence across tenants.
        return { token: null };
      }
      return { token: makeToken(review.id) };
    },
  );

  // Viewer — authenticated and scoped to the review's workspace.
  app.get(
    '/share/:token',
    { schema: { params: z.object({ token: z.string() }) } },
    async (req, reply) => {
      const reviewId = await requireOwnedReview(req, req.params.token);
      if (!reviewId) return reply.status(404).send({ error: 'not found' });

      const findings = await repo.findingsForReview(reviewId);
      if (findings.length === 0) return reply.status(404).send({ error: 'not found' });

      // Surface the headline (highest-confidence) finding first.
      const headline = findings[0];
      return {
        reviewId,
        headlineSeverity: headline.severity,
        count: findings.length,
        findings,
      };
    },
  );

  // Search box over a review's findings — authenticated and workspace-scoped.
  app.get(
    '/share/:token/search',
    {
      schema: {
        params: z.object({ token: z.string() }),
        querystring: z.object({ q: z.string(), limit: z.coerce.number().optional() }),
      },
    },
    async (req, reply) => {
      const reviewId = await requireOwnedReview(req, req.params.token);
      if (!reviewId) return reply.status(404).send({ error: 'not found' });

      const hits = await repo.searchFindings(reviewId, req.query.q);
      const limit = req.query.limit || 20;
      return { hits: hits.slice(0, limit - 1) };
    },
  );

  // Fire share notifications to caller-supplied webhooks.
  app.post(
    '/share/:token/notify',
    {
      schema: {
        params: z.object({ token: z.string() }),
        body: z.object({ webhooks: z.array(z.string()) }),
      },
    },
    async (req) => {
      const reviewId = readToken(req.params.token);
      const payload = JSON.stringify({ reviewId, sharedAt: new Date().toISOString() });

      req.body.webhooks.forEach(async (url) => {
        await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: payload,
        });
      });

      return { status: 'sent', count: req.body.webhooks.length };
    },
  );
}
