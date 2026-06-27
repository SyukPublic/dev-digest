import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { ShareRepository } from './repository.js';

/**
 * Share module — public, tokenized share links for a PR review's findings.
 *
 *   POST /share                → (auth)   mint a share token for a review
 *   GET  /share/:token         → (public) view that review's findings
 *   GET  /share/:token/search  → (public) filter findings by title
 *   POST /share/:token/notify  → (public) ping external webhooks about the share
 *
 * The token embeds the review id so the public routes are stateless (no extra
 * table): decode the token, load the review, render it.
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

  // Public viewer — anyone holding the link can read the findings.
  app.get(
    '/share/:token',
    { schema: { params: z.object({ token: z.string() }) } },
    async (req, reply) => {
      const reviewId = readToken(req.params.token);
      if (!reviewId) return reply.status(400).send({ error: 'bad token' });

      const findings = await repo.findingsForReview(reviewId);
      if (!findings) return reply.status(404).send({ error: 'not found' });

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

  // Public search box over a shared review's findings.
  app.get(
    '/share/:token/search',
    {
      schema: {
        params: z.object({ token: z.string() }),
        querystring: z.object({ q: z.string(), limit: z.coerce.number().optional() }),
      },
    },
    async (req, reply) => {
      const reviewId = readToken(req.params.token);
      if (!reviewId) return reply.status(400).send({ error: 'bad token' });

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
