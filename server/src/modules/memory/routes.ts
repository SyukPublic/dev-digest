import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { CreateMemory, MemoryListQuery, UpdateMemory } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { MemoryService } from './service.js';

/**
 * Review Memory — transport layer only (Onion rule 6: thin routes).
 *   GET    /memory          → list (filters + facet counts) or semantic search (`q`)
 *   GET    /memory/:id      → one entry
 *   POST   /memory          → create
 *   PATCH  /memory/:id      → partial update
 *   DELETE /memory/:id      → delete
 *
 * Every request is workspace-scoped via `getContext`; a row not in the caller's
 * workspace is not-found (AC-8, no cross-tenant access). Bodies/queries are
 * parsed against the shared Zod contracts (no `req.body`/`req.query` cast, no
 * mass-assignment — A08). The embedding is server-derived, never client-supplied.
 */
export default async function memoryRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new MemoryService(app.container);

  app.get('/memory', { schema: { querystring: MemoryListQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.query);
  });

  app.get('/memory/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const item = await service.getById(workspaceId, req.params.id);
    if (!item) throw new NotFoundError('Memory entry not found');
    return item;
  });

  app.post('/memory', { schema: { body: CreateMemory } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const item = await service.create(workspaceId, req.body);
    reply.code(201);
    return item;
  });

  app.patch('/memory/:id', { schema: { params: IdParams, body: UpdateMemory } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const item = await service.update(workspaceId, req.params.id, req.body);
    if (!item) throw new NotFoundError('Memory entry not found');
    return item;
  });

  app.delete('/memory/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Memory entry not found');
    reply.code(204);
  });
}
