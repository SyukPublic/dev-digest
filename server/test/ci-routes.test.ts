import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  validatorCompiler,
  serializerCompiler,
  hasZodFastifySchemaValidationErrors,
} from 'fastify-type-provider-zod';
import ciRoutes from '../src/modules/ci/routes.js';
import { modules } from '../src/modules/index.js';

/**
 * `buildRoutesOnly` mirrors `app.ts`'s zod-validation wiring (compiler +
 * error handler) WITHOUT the full app (no DB, no container query at
 * registration time) — enough to exercise the route-level `schema.body`
 * contract boundary in isolation.
 */
async function buildRoutesOnly(): Promise<FastifyInstance> {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((err: unknown, _req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      reply.status(422).send({
        error: { code: 'validation_error', message: 'Request validation failed' },
      });
      return;
    }
    reply.status(500).send({ error: { code: 'internal_error' } });
  });
  app.decorate('container', { db: {} } as never);
  await app.register(ciRoutes);
  await app.ready();
  return app;
}

/**
 * Route-registration unit test (T9) — the `ci` module is wired into the registry
 * and exposes its endpoints (AC-2 enabler). Hermetic: a bare Fastify app with a
 * stub container (routes only store `container.db`, they never query it here).
 */
describe('ci module registration', () => {
  it('test_export_route_registered: ci routes are declared', async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    // The routes plugin builds `new CiService(app.container)` which only reads
    // `container.db` into a repository (no query at registration time).
    app.decorate('container', { db: {} } as never);
    await app.register(ciRoutes);
    await app.ready();

    expect(app.hasRoute({ method: 'POST', url: '/agents/:id/export-ci' })).toBe(true);
    expect(app.hasRoute({ method: 'GET', url: '/agents/:id/ci-runs' })).toBe(true);
    expect(app.hasRoute({ method: 'GET', url: '/agents/:id/ci-installations' })).toBe(true);
    expect(app.hasRoute({ method: 'GET', url: '/ci-runs' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/ci-runs/ingest' })).toBe(true);

    await app.close();
  });

  it('the ci plugin is in the module registry', () => {
    expect(modules.ci).toBeDefined();
  });
});

describe('POST /agents/:id/export-ci — request-contract validation (Zod-contract rule)', () => {
  it('a body missing the required "repo" is rejected 422 with a validation_error shape, never a 500/crash', async () => {
    const app = await buildRoutesOnly();
    const res = await app.inject({
      method: 'POST',
      url: '/agents/11111111-1111-1111-1111-111111111111/export-ci',
      payload: {}, // CiExportInput.repo is z.string().min(1) — required
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'validation_error' } });
    await app.close();
  });

  it('an invalid "action" enum value is rejected 422, not silently coerced', async () => {
    const app = await buildRoutesOnly();
    const res = await app.inject({
      method: 'POST',
      url: '/agents/11111111-1111-1111-1111-111111111111/export-ci',
      payload: { repo: 'acme/api', action: 'delete_everything' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'validation_error' } });
    await app.close();
  });

  it('a non-uuid agent id in the path is rejected 422 before the body is even parsed', async () => {
    const app = await buildRoutesOnly();
    const res = await app.inject({
      method: 'POST',
      url: '/agents/not-a-uuid/export-ci',
      payload: { repo: 'acme/api' },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});
