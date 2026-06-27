import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { randomUUID } from 'node:crypto';
import { SmartDiffResponse } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;

/** Seed a repo + PR (+ optionally pr_files rows) and return the PR id. */
async function setupPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  files: { path: string; additions: number; deletions: number; patch?: string }[],
) {
  const name = `smart-diff-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 1,
      title: 'Smart diff PR',
      author: 'dev',
      branch: 'feat/x',
      base: 'main',
      headSha: 'deadbeef',
      additions: files.reduce((s, f) => s + f.additions, 0),
      deletions: files.reduce((s, f) => s + f.deletions, 0),
      filesCount: files.length,
      status: 'needs_review',
      body: '',
    })
    .returning();
  if (files.length > 0) {
    await db.insert(t.prFiles).values(
      files.map((f) => ({
        prId: pr!.id,
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? null,
      })),
    );
  }
  return pr!.id as string;
}

/** Insert a `kind:'review'` row + its findings directly (no real LLM run). */
async function insertReviewWithFindings(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  prId: string,
  findings: {
    file: string;
    startLine: number;
    endLine: number;
    dismissedAt?: Date | null;
  }[],
) {
  const [review] = await db
    .insert(t.reviews)
    .values({
      workspaceId,
      prId,
      agentId: null,
      runId: null,
      kind: 'review',
      verdict: 'comment',
      summary: 'seeded',
      score: 80,
      model: 'mock',
    })
    .returning();
  if (findings.length > 0) {
    await db.insert(t.findings).values(
      findings.map((f) => ({
        reviewId: review!.id,
        file: f.file,
        startLine: f.startLine,
        endLine: f.endLine,
        severity: 'CRITICAL',
        category: 'security',
        title: 'seeded finding',
        rationale: 'seeded',
        confidence: 0.9,
        dismissedAt: f.dismissedAt ?? null,
      })),
    );
  }
  return review!.id as string;
}

d('smart-diff route (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('PR with files, no review → 200, groups populated, all finding_lines empty', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const prId = await setupPr(pg.handle.db, workspaceId, [
      { path: 'server/src/modules/reviews/service.ts', additions: 10, deletions: 2 },
      { path: 'next.config.ts', additions: 1, deletions: 0 },
      { path: 'pnpm-lock.yaml', additions: 200, deletions: 50 },
    ]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = SmartDiffResponse.parse(res.json());

    // Groups present in core, wiring, boilerplate order.
    expect(body.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    // Every file has empty finding_lines (no review yet).
    for (const group of body.groups) {
      for (const file of group.files) expect(file.finding_lines).toEqual([]);
    }
    // pseudocode_summary is null everywhere (no LLM).
    for (const group of body.groups) {
      for (const file of group.files) expect(file.pseudocode_summary).toBeNull();
    }

    await app.close();
  });

  it('PR with a review + non-dismissed finding → matching file carries expanded finding_lines', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const prId = await setupPr(pg.handle.db, workspaceId, [
      { path: 'server/src/config.ts', additions: 5, deletions: 1 },
      { path: 'README.md', additions: 1, deletions: 0 },
    ]);
    await insertReviewWithFindings(pg.handle.db, workspaceId, prId, [
      { file: 'server/src/config.ts', startLine: 10, endLine: 12 },
    ]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = SmartDiffResponse.parse(res.json());

    const allFiles = body.groups.flatMap((g) => g.files);
    const configFile = allFiles.find((f) => f.path === 'server/src/config.ts');
    const readme = allFiles.find((f) => f.path === 'README.md');
    // Inclusive [10..12] expansion.
    expect(configFile?.finding_lines).toEqual([10, 11, 12]);
    // README.md (core) has no findings.
    expect(readme?.finding_lines).toEqual([]);
    // config.ts is core (real logic).
    const coreGroup = body.groups.find((g) => g.role === 'core');
    expect(coreGroup?.files.some((f) => f.path === 'server/src/config.ts')).toBe(true);

    await app.close();
  });

  it('dismissed finding contributes no lines', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const prId = await setupPr(pg.handle.db, workspaceId, [
      { path: 'server/src/dismissed.ts', additions: 3, deletions: 0 },
    ]);
    await insertReviewWithFindings(pg.handle.db, workspaceId, prId, [
      { file: 'server/src/dismissed.ts', startLine: 5, endLine: 6, dismissedAt: new Date() },
    ]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = SmartDiffResponse.parse(res.json());

    const file = body.groups.flatMap((g) => g.files).find((f) => f.path === 'server/src/dismissed.ts');
    expect(file?.finding_lines).toEqual([]);

    await app.close();
  });

  it('PR with zero files → 200 empty groups, total_lines 0, too_big false', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const prId = await setupPr(pg.handle.db, workspaceId, []);

    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = SmartDiffResponse.parse(res.json());

    expect(body.groups).toEqual([]);
    expect(body.split_suggestion.total_lines).toBe(0);
    expect(body.split_suggestion.too_big).toBe(false);

    await app.close();
  });

  it('unknown / other-workspace PR id → 404', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({ method: 'GET', url: `/pulls/${randomUUID()}/smart-diff` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  // ── HEAD-MOVED scenario (gap 25b / Smart-Diff exclusion) ─────────────────
  // The latest review has a headSha that DIFFERS from the PR's headSha. It has:
  //   - one `moved_out` finding (line 999, not in any pr_files hunk)
  //   - one `current` finding  (line 11, inside the pr_files patch)
  // Expected: the resulting `finding_lines` for that file INCLUDES the current
  // finding's expanded lines [11] and EXCLUDES the moved_out finding's line [999].
  it('excludes moved_out findings and keeps current findings when the review head moved', async () => {
    // Intention:
    //   Unit under test : SmartDiffService.getSmartDiff (via GET /pulls/:id/smart-diff)
    //   Input           : PR headSha='new-sha'; review headSha='old-sha' (moved)
    //                     pr_files patch covers new-side lines 10–14 of src/moved.ts
    //                     finding A: src/moved.ts line 11 (in hunk) → current
    //                     finding B: src/moved.ts line 999 (NOT in hunk) → moved_out
    //   Stubs/Fakes     : real Postgres (testcontainer)
    //   Expected        : finding_lines for src/moved.ts == [11] (A included, B excluded)

    const app = await buildApp({ config: config(), db: pg.handle.db });

    // Insert repo + PR with headSha='new-sha'.
    const name = `smart-diff-moved-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();

    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 99,
        title: 'Head-moved PR',
        author: 'dev',
        branch: 'feat/moved',
        base: 'main',
        headSha: 'new-sha', // current head
        additions: 5,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: '',
      })
      .returning();

    // pr_files reflect the CURRENT head (new-sha). Patch covers new-side lines 10–14.
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/moved.ts',
      additions: 5,
      deletions: 0,
      patch: '@@ -10,3 +10,5 @@\n   existing;\n+  lineA;\n+  lineB;\n+  lineC;\n+  lineD;',
    });

    // Insert review with headSha='old-sha' (moved — different from PR's 'new-sha').
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        agentId: null,
        runId: null,
        kind: 'review',
        verdict: 'comment',
        summary: 'seeded',
        score: 80,
        model: 'mock',
        headSha: 'old-sha', // intentionally different from PR headSha
      })
      .returning();

    // Finding A: line 11 → inside the hunk (current).
    // Finding B: line 999 → outside every hunk (moved_out).
    await pg.handle.db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/moved.ts',
        startLine: 11,
        endLine: 11,
        severity: 'CRITICAL',
        category: 'security',
        title: 'current finding',
        rationale: 'seeded',
        confidence: 0.9,
      },
      {
        reviewId: review!.id,
        file: 'src/moved.ts',
        startLine: 999,
        endLine: 999,
        severity: 'WARNING',
        category: 'bug',
        title: 'moved_out finding',
        rationale: 'seeded',
        confidence: 0.7,
      },
    ]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr!.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = SmartDiffResponse.parse(res.json());

    const allFiles = body.groups.flatMap((g) => g.files);
    const movedFile = allFiles.find((f) => f.path === 'src/moved.ts');

    // Line 11 (current finding) MUST appear.
    expect(movedFile?.finding_lines).toContain(11);
    // Line 999 (moved_out finding) MUST NOT appear.
    expect(movedFile?.finding_lines).not.toContain(999);

    await app.close();
  });
});
