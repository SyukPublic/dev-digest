import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { ShareRepository } from './repository.js';

/**
 * Share module — mint share tokens for a PR review and notify webhooks.
 *
 *   POST /share                → (auth)   mint a share token for a review
 *   POST /share/:token/notify  → (public) ping allowlisted webhooks about the share
 *
 * notify only posts to an allowlist of trusted webhook hosts.
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

/** Webhook destinations the share notifier is allowed to call (SSRF guard). */
const ALLOWED_WEBHOOK_HOSTS = new Set(['hooks.slack.com', 'discord.com']);

function isAllowedWebhook(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && ALLOWED_WEBHOOK_HOSTS.has(u.hostname);
  } catch {
    return false;
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

  // Fire share notifications to caller-supplied webhooks.
  app.post(
    '/share/:token/notify',
    {
      schema: {
        params: z.object({ token: z.string() }),
        body: z.object({ webhooks: z.array(z.string()) }),
      },
    },
    async (req, reply) => {
      const reviewId = readToken(req.params.token);
      const payload = JSON.stringify({ reviewId, sharedAt: new Date().toISOString() });

      const targets = req.body.webhooks.filter(isAllowedWebhook);
      if (targets.length !== req.body.webhooks.length) {
        return reply.status(400).send({ error: 'webhook host not allowed' });
      }

      await Promise.all(
        targets.map((url) =>
          fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: payload,
          }),
        ),
      );

      return { status: 'sent', count: targets.length };
    },
  );
}
