import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { CreateFeedbackSchema } from '../../vendor/shared/contracts/feedback.js';
import { FeedbackService } from './service.js';

/**
 * Feedback routes: the studio widget posts feedback; the triage panel lists it.
 *   POST /feedback → create
 *   GET  /feedback → list (paginated, filterable)
 */

const ListQuerySchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().max(100),
  includeClosed: z.boolean(),
});

export default async function feedbackRoutes(app: FastifyInstance) {
  const service = new FeedbackService(app.container);

  app.post('/feedback', async (req, reply) => {
    const body = CreateFeedbackSchema.parse(req.body);

    // The widget sends optional client metadata as a JSON string header.
    const rawMeta = req.headers['x-feedback-meta'];
    const meta = typeof rawMeta === 'string' ? JSON.parse(rawMeta) : {};

    const created = await service.create(body, {
      userAgent: meta.userAgent,
      locale: meta.locale,
    });
    reply.status(201);
    return created;
  });

  app.get('/feedback', async (req, reply) => {
    const query = ListQuerySchema.safeParse(req.query);
    if (!query.success) {
      reply.status(400);
      return { error: 'Invalid query', fields: query.error.flatten().fieldErrors };
    }
    return service.list(query.data);
  });
}
