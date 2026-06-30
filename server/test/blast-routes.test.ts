/**
 * Phase 3 (L04 Blast Radius) — GET /pulls/:id/blast route tests.
 *
 * app.inject() with the service method spied so no real DB access happens, plus
 * MockAuthProvider for tenancy context. Verifies the HTTP shape (200
 * BlastResponse), the param 422 guard, and the 404 NotFound mapping.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { BlastService } from '../src/modules/blast/service.js';
import { ReviewService } from '../src/modules/reviews/service.js';
import { MockAuthProvider } from '../src/adapters/mocks.js';
import { NotFoundError } from '../src/platform/errors.js';
import type { BlastResponse } from '@devdigest/shared';

const PR_UUID = '22222222-2222-2222-2222-222222222222';

const BLAST_RESPONSE: BlastResponse = {
  pr_id: PR_UUID,
  blast: {
    changed_symbols: [{ name: 'doThing', file: 'src/a.ts', kind: 'function' }],
    downstream: [
      {
        symbol: 'doThing',
        callers: [{ name: 'caller', file: 'src/b.ts', line: 12 }],
        endpoints_affected: ['GET /things'],
        crons_affected: [],
      },
    ],
    summary: '1 changed symbol(s) reaching 1 caller(s) across 1 endpoint(s).',
  },
  status: 'full',
  degraded_reason: null,
};

describe('GET /pulls/:id/blast (route)', () => {
  const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

  beforeEach(() => {
    vi.spyOn(ReviewService.prototype, 'reapStaleRuns').mockResolvedValue(0);
    vi.spyOn(BlastService.prototype, 'getBlast').mockResolvedValue(BLAST_RESPONSE);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('→ 200 with the BlastResponse shape', async () => {
    const app = await buildApp({ config, overrides: { auth: new MockAuthProvider() } });
    const res = await app.inject({ method: 'GET', url: `/pulls/${PR_UUID}/blast` });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pr_id).toBe(PR_UUID);
    expect(body.status).toBe('full');
    expect(Array.isArray(body.blast.downstream)).toBe(true);
    expect(body.blast.downstream[0].callers[0].name).toBe('caller');
  });

  it('→ 422 on a non-uuid param', async () => {
    const app = await buildApp({ config, overrides: { auth: new MockAuthProvider() } });
    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/blast' });
    await app.close();

    expect(res.statusCode).toBe(422);
  });

  it('→ 404 when the service throws NotFoundError (cross-tenant / unknown PR)', async () => {
    vi.spyOn(BlastService.prototype, 'getBlast').mockRejectedValue(
      new NotFoundError('Pull request not found'),
    );
    const app = await buildApp({ config, overrides: { auth: new MockAuthProvider() } });
    const res = await app.inject({ method: 'GET', url: `/pulls/${PR_UUID}/blast` });
    await app.close();

    expect(res.statusCode).toBe(404);
  });
});
