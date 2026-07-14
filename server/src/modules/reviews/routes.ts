import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  RunRequest,
  PrIntentRecord,
  PrRisksRecord,
  MultiAgentRunRequest,
  MultiAgentRunLaunch,
  MultiAgentRun,
  AgentEstimates,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewService } from './service.js';
import { MultiRunService } from './multi-run-service.js';
import { streamRunEvents } from '../../platform/sse.js';

/**
 * reviews module.
 *   POST   /pulls/:id/review  {agentId} | {all:true}  → run review(s); returns runs
 *   GET    /runs/:id/events                            → SSE stream of RunEvent (replay-first)
 *   GET    /runs/:id/trace                             → the single-document RunTrace
 *   GET    /pulls/:id/reviews                          → persisted reviews + findings for a PR
 *   POST   /findings/:id/(accept|dismiss)              → finding actions
 */
const FINDING_ACTIONS = ['accept', 'dismiss'] as const;
export default async function reviewsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ReviewService(container);
  const multiRun = new MultiRunService(container);

  // ---- Run a review (manual trigger) -------------------------------
  // Tight per-route limit: each call can fan out to expensive LLM runs.
  // Body stays a tolerant manual parse (both fields optional; empty body is OK).
  app.post(
    '/pulls/:id/review',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
    const { workspaceId } = await getContext(container, req);
    const body = RunRequest.parse(req.body ?? {});
    const targets = await service.resolveTargets(workspaceId, {
      ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
      ...(body.all !== undefined ? { all: body.all } : {}),
    });
    const { runs, reviews } = await service.runReview(
      workspaceId,
      req.params.id,
      targets,
      req.log,
    );
    return { pr_id: req.params.id, runs, reviews };
  });

  // ---- Launch an N-agent multi-run (parse the body ONCE at the edge) -------
  // Same tight per-route limit as /review: each call fans out to N LLM runs.
  // (config.rateLimit is a no-op under tests — buildApp only registers
  // @fastify/rate-limit when nodeEnv!=='test'; the route still CARRIES it.)
  app.post(
    '/pulls/:id/multi-agent-run',
    {
      schema: {
        params: IdParams,
        body: MultiAgentRunRequest,
        response: { 200: MultiAgentRunLaunch },
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return multiRun.launch(workspaceId, req.params.id, req.body.agent_ids, req.log);
    },
  );

  // ---- Read the latest assembled multi-agent run for a PR (null when none) --
  // Columns + on-read aggregates + conflicts (computed, not stored — DEC-D).
  app.get(
    '/pulls/:id/multi-agent',
    { schema: { params: IdParams, response: { 200: MultiAgentRun.nullable() } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return multiRun.getLatest(workspaceId, req.params.id);
    },
  );

  // ---- Per-agent pre-launch estimates (history-based) ----------------------
  // STATIC path: find-my-way resolves it before the agents module's
  // parametric `/agents/:id`, so there is no clash (DEC-E). Hosted here because
  // the estimate rolls up over `agent_runs`, which this module owns.
  app.get(
    '/agents/estimates',
    { schema: { response: { 200: AgentEstimates } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return multiRun.estimates(workspaceId);
    },
  );

  // ---- SSE: live run events (replay buffer first, then live; ends on done) -
  // No rate limit: SSE is one long-lived connection, not burst traffic.
  app.get(
    '/runs/:id/events',
    { schema: { params: IdParams }, config: { rateLimit: false } },
    async (req, reply) => {
    await getContext(container, req);
    reply.sse(streamRunEvents(container.runBus, req.params.id));
  });

  // ---- Active (in-flight) runs for a PR (server source of truth) ----------
  app.get('/pulls/:id/runs/active', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.activeRuns(workspaceId, req.params.id);
  });

  // ---- All runs for a PR (any status; the run history, incl. failures) -----
  app.get('/pulls/:id/runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId, req.params.id);
  });

  // ---- Delete one run from the history (+ its trace) ----------------------
  app.delete('/runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteRun(workspaceId, req.params.id);
    return { ok };
  });

  // ---- Cancel an in-flight run --------------------------------------------
  app.post('/runs/:id/cancel', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    await service.cancelRun(req.params.id);
    return { ok: true };
  });

  // ---- Run trace (single document; A5 enriches with multi-agent/stats) ----
  app.get('/runs/:id/trace', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    const trace = await service.getRunTrace(req.params.id);
    if (!trace) throw new NotFoundError('Run trace not found');
    return trace;
  });

  // ---- Reads --------------------------------------------------------------
  app.get('/pulls/:id/reviews', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.reviewsForPull(workspaceId, req.params.id);
  });

  // ---- Delete a whole review run (one agent's pass) + its findings --------
  app.delete('/reviews/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteReview(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Review not found');
    return { ok: true };
  });

  // ---- Finding actions (accept / dismiss) ---------------------------------
  for (const action of FINDING_ACTIONS) {
    app.post(`/findings/:id/${action}`, { schema: { params: IdParams } }, async (req) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.actOnFinding(workspaceId, req.params.id, action);
      return result;
    });
  }

  // ---- Intent: read (null when not computed yet) --------------------------
  app.get(
    '/pulls/:id/intent',
    { schema: { params: IdParams, response: { 200: PrIntentRecord.nullable() } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getIntent(workspaceId, req.params.id);
    },
  );

  // ---- Intent: recompute (rate-limited — each call triggers an LLM run) ----
  app.post(
    '/pulls/:id/intent/recompute',
    {
      schema: { params: IdParams, response: { 200: PrIntentRecord } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.recomputeIntent(workspaceId, req.params.id);
    },
  );

  // ---- Risks: read (null when not computed yet — ON-DEMAND only) ----------
  app.get(
    '/pulls/:id/risks',
    { schema: { params: IdParams, response: { 200: PrRisksRecord.nullable() } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getRisks(workspaceId, req.params.id);
    },
  );

  // ---- Risks: recompute (rate-limited — each call triggers an LLM run) ----
  app.post(
    '/pulls/:id/risks/recompute',
    {
      schema: { params: IdParams, response: { 200: PrRisksRecord } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.recomputeRisks(workspaceId, req.params.id);
    },
  );
}
