import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { analyzeRisks } from '../src/modules/reviews/risks-service.js';

/**
 * Phase 7 (T28 / AC-9 — migration posture) — the STANDALONE risks path stays
 * "dead-but-present".
 *
 * The why-risk-brief feature intentionally does NOT delete the standalone
 * `GET/POST /pulls/:id/risks` endpoints nor the `analyzeRisks` service; removing
 * them is a separate follow-up, out of this feature's scope. This test PINS that
 * posture: if someone deletes the routes or the service, it fails — flagging the
 * (out-of-scope) removal instead of letting it slip in silently.
 *
 * Unit under test: the composed Fastify app's route table (no DB — `buildApp`
 * connects postgres-js lazily, same as `routes-smoke.test.ts`) plus the
 * `risks-service` module export. No stubs: this deliberately exercises the real
 * module registry / production wiring.
 * Expected output: the app registers `GET /pulls/:id/risks` and
 * `POST /pulls/:id/risks/recompute`, and `analyzeRisks` remains an exported
 * function.
 */
const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

describe('risks endpoints — dead-but-present (T28/AC-9 migration posture)', () => {
  it('still registers GET/POST /pulls/:id/risks in the app route table', async () => {
    const app = await buildApp({ config });
    await app.ready();

    // Fastify 5 hasRoute() matches against the composed router — the modules are
    // already registered inside buildApp, so this reflects real production wiring.
    expect(app.hasRoute({ method: 'GET', url: '/pulls/:id/risks' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/pulls/:id/risks/recompute' })).toBe(true);

    await app.close();
  });

  it('keeps analyzeRisks exported and unused-but-present (not deleted)', () => {
    // The standalone risks service must still resolve as a function. Its removal
    // is a separate follow-up outside this feature — assert it was NOT dropped.
    expect(typeof analyzeRisks).toBe('function');
  });
});
