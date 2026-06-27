import * as t from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { PgFixture } from './pg.js';

/**
 * `runReview` is fire-and-forget: the POST returns runIds immediately and each
 * agent's review is persisted in the background (the client subscribes to SSE).
 * Tests that assert on persisted reviews/findings/traces must first wait for the
 * background runs to finish. This polls `agent_runs` until every row for the PR
 * reaches a terminal status (done / failed / cancelled).
 *
 * On timeout it THROWS (never returns non-terminal rows): a returned-early,
 * still-`running` set makes the caller read an empty `/reviews` list and blow up
 * later with a cryptic `Cannot read properties of undefined (reading 'findings')`.
 * Throwing here turns that into a loud, accurate failure that names the PR and
 * the run statuses we actually saw.
 *
 * The default budget is deliberately generous (30s): a single mock review still
 * does ~15 sequential round-trips to the Dockerized Postgres, and in an ISOLATED
 * run this file pays cold-start costs (JIT, first pool connection, Docker page
 * cache) that the full suite has already warmed — so a review that finishes in
 * <2s under load can take 10-18s cold. The old 10s budget sat right on that tail,
 * making isolated runs flaky while the warm full suite stayed green.
 */
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

export async function waitForPrRuns(
  db: PgFixture['handle']['db'],
  prId: string,
  opts: { expected?: number; timeoutMs?: number } = {},
): Promise<Array<typeof t.agentRuns.$inferSelect>> {
  const { expected, timeoutMs = 30_000 } = opts;
  const start = Date.now();
  for (;;) {
    const runs = await db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, prId));
    const terminal = runs.filter((r) => TERMINAL.has(r.status ?? ''));
    // With an explicit `expected`, wait until that many runs finish (ignores any
    // extra rows, e.g. a trifecta scan). Otherwise wait for all rows to settle.
    const done =
      expected != null
        ? terminal.length >= expected
        : runs.length > 0 && terminal.length === runs.length;
    if (done) return runs;
    if (Date.now() - start > timeoutMs) {
      const statuses = runs.map((r) => `${r.id.slice(0, 8)}=${r.status}`).join(', ') || '(no rows)';
      const target = expected != null ? `>=${expected}` : 'all';
      throw new Error(
        `waitForPrRuns: expected ${target} terminal agent_runs for pr ${prId} within ` +
          `${timeoutMs}ms, saw ${terminal.length}/${runs.length} terminal — [${statuses}]`,
      );
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}
