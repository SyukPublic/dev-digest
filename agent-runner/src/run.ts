import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type {
  LLMProvider,
  GitHubReviewPayload,
  CiResultArtifact,
  UnifiedDiff,
} from '@devdigest/shared';
import { reviewPullRequest, toReviewPayload, gateTriggered, countBlockers } from '@devdigest/reviewer-core';
import { findManifestPaths, loadAgentManifest, manifestSlugFromPath } from './manifest.js';
import { loadSkillBodies } from './skills.js';
import { resolvePrContext, type CiEnv, type PrContext } from './context.js';
import { parseUnifiedDiff, stripIgnoredFiles } from './diff.js';
import { fetchPrDiff, postGithubReview, postPrComment, type FetchLike } from './github.js';
import { buildResultArtifact } from './artifact.js';
import { RunnerError } from './errors.js';

/**
 * `runCi` — the runner's single orchestration entry point. Loads EVERY installed
 * agent manifest and reviews the PR with each, so a repo with N agents runs N
 * reviews on one job (multi-agent CI, AC-58/AC-59/AC-60). Each agent runs the
 * SAME reviewer-core engine the studio calls — `assemblePrompt`/`wrapUntrusted`
 * (INJECTION_GUARD) and the mandatory `groundFindings()` gate live INSIDE
 * `reviewPullRequest`; this file never re-implements them. It only resolves the
 * shared CI inputs (PR context + diff, fetched ONCE) and, per agent, the
 * agent-specific inputs (manifest, skills), then turns the grounded result into
 * that agent's own GitHub side effects + its own result artifact.
 *
 * Deterministic gate (per agent, AC-68): the GitHub review event + blocker count
 * come from `countBlockers`/`gateTriggered` + the manifest's `ci_fail_on` against
 * the GROUNDED findings — never `review.verdict` (the model's self-report).
 *
 * Per-agent isolation (AC-61): each agent runs inside its OWN try/catch, so one
 * agent tripping its gate OR hard-failing (invalid manifest / model error) still
 * runs and posts the rest — no cross-agent short-circuit. The process exit is the
 * aggregate OR, computed only AFTER every agent has run (AC-69): non-zero iff any
 * agent's gate tripped or any agent hard-failed.
 *
 * Each agent writes its OWN `devdigest-result-<slug>.json` (slug = the manifest
 * file basename), identifying the agent so ingest maps each result to its own
 * installation (AC-64). A hard-failed agent writes NO artifact (no synthetic
 * review skeleton) — ingest records it as a failed run for its own install from
 * the absence of its result file on a completed run.
 */

export type PostAs = 'github_review' | 'pr_comment' | 'none';

export interface RunCiDeps {
  /** Directory containing `agents/` and `skills/` (checked-in `.devdigest/`). */
  devdigestDir: string;
  env: CiEnv;
  /** Injected LLM provider — `OpenRouterProvider` in production, a stub in tests. */
  llm: LLMProvider;
  /** How to post the result — `'github_review' | 'pr_comment' | 'none'` (AC-24). */
  postAs: PostAs;
  /**
   * Base path for result artifacts. Each agent writes a per-agent file derived
   * from it: `<base without .json>-<slug>.json`. The workflow uploads them all
   * (glob `devdigest-result*.json`).
   */
  resultPath: string;
  fetchImpl?: FetchLike;
  readFile?: typeof readFileSync;
  readDir?: typeof readdirSync;
  writeFile?: typeof writeFileSync;
  now?: () => number;
  /**
   * Override diff retrieval (tests supply a fixture diff directly instead of
   * hitting the GitHub API). Defaults to `fetchPrDiff` via the GitHub REST API.
   */
  fetchDiff?: (
    ctx: { owner: string; repo: string; prNumber: number },
    token: string,
    fetchImpl: FetchLike,
  ) => Promise<string>;
}

/** The outcome of reviewing ONE installed agent. */
export interface AgentRunResult {
  /** Manifest-file basename slug = the artifact's `agent` identity (AC-64). */
  slug: string;
  /** The manifest's display name (informational, for logs). */
  agentName: string;
  /** 1 iff this agent's gate tripped OR it hard-failed; else 0. */
  exitCode: number;
  artifact: CiResultArtifact | null;
  posted: { kind: PostAs; payload?: GitHubReviewPayload } | null;
  blockers?: number;
  gateTriggered?: boolean;
  error?: string;
  /** Absolute path this agent's artifact was written to. */
  resultPath: string;
}

export interface RunCiResult {
  /** Aggregate exit (AC-69): 1 iff ANY agent's gate tripped or hard-failed. */
  exitCode: number;
  /** One entry per installed agent (empty on a whole-run setup failure). */
  agents: AgentRunResult[];
  /** Set only on a whole-run failure BEFORE any agent could run (no manifests / diff fetch). */
  error?: string;
}

/** Derive a per-agent result path from the base (`devdigest-result.json` → `…-<slug>.json`). */
export function resultPathFor(base: string, slug: string): string {
  return `${base.replace(/\.json$/i, '')}-${slug}.json`;
}

/**
 * Review ONE agent end-to-end, isolated. Any failure — invalid manifest, missing
 * skill file, or an LLM/model-call error inside `reviewPullRequest` — is caught
 * here and returned as a per-agent error (exit 1) WITHOUT posting a partial state
 * or a synthetic review, so it never stops the other agents (AC-61).
 */
async function reviewAgent(params: {
  manifestPath: string;
  slug: string;
  devdigestDir: string;
  ctx: PrContext;
  diff: UnifiedDiff;
  llm: LLMProvider;
  postAs: PostAs;
  githubToken: string | undefined;
  resultPath: string;
  fetchImpl: FetchLike;
  readFile: typeof readFileSync;
  writeFile: typeof writeFileSync;
  now: () => number;
}): Promise<AgentRunResult> {
  const { slug, resultPath } = params;
  try {
    // Load + validate this agent's manifest BEFORE it is used (AC-20), then its skills.
    const manifest = loadAgentManifest(params.manifestPath, { readFile: params.readFile });
    const skills = loadSkillBodies(params.devdigestDir, manifest.skills, params.readFile);

    // Run the SAME engine the studio uses — `assemblePrompt`/`wrapUntrusted`
    // (diff → <untrusted source="diff">, prDescription → <untrusted
    // source="pr-description">, AC-21/AC-78) and the mandatory `groundFindings()`
    // gate all run INSIDE `reviewPullRequest`, once per agent.
    const start = params.now();
    const outcome = await reviewPullRequest({
      systemPrompt: manifest.system_prompt,
      model: manifest.model,
      diff: params.diff,
      llm: params.llm,
      strategy: manifest.strategy,
      skills,
      prDescription: params.ctx.body,
      task: `Review PR #${params.ctx.prNumber}: ${params.ctx.title}`,
    });
    const durationMs = params.now() - start;

    // Deterministic verdict/gate from GROUNDED findings + this agent's own
    // `ci_fail_on` (AC-68) — never `outcome.review.verdict`.
    const payload = toReviewPayload(outcome.review, {
      failOn: manifest.ci_fail_on,
      diff: params.diff,
      title: manifest.name,
    });
    const blockers = countBlockers(outcome.review.findings, manifest.ci_fail_on);
    const triggered = gateTriggered(outcome.review.findings, manifest.ci_fail_on);

    // Build + write this agent's artifact BEFORE posting, so a GitHub-side
    // posting failure never loses the already-computed, already-grounded result.
    // `agent` = the STABLE manifest-file slug (AC-64), NOT `manifest.name`.
    const artifact = buildResultArtifact({
      findings: outcome.review.findings,
      costUsd: outcome.costUsd,
      durationMs,
      agent: slug,
      prNumber: params.ctx.prNumber,
    });
    params.writeFile(resultPath, `${JSON.stringify(artifact, null, 2)}\n`);

    // Post per `post_as` (AC-24/AC-60) — each agent posts its OWN result independently.
    if (params.postAs === 'github_review') {
      await postGithubReview(params.ctx, params.githubToken as string, payload, params.fetchImpl);
    } else if (params.postAs === 'pr_comment') {
      await postPrComment(params.ctx, params.githubToken as string, payload.body, params.fetchImpl);
    }

    return {
      slug,
      agentName: manifest.name,
      exitCode: triggered ? 1 : 0,
      artifact,
      posted: { kind: params.postAs, payload },
      blockers,
      gateTriggered: triggered,
      resultPath,
    };
  } catch (err) {
    // Per-agent hard-fail: non-zero contribution, nothing posted, no artifact, no
    // synthetic review — the other agents still run (AC-61).
    const message = err instanceof Error ? err.message : String(err);
    return { slug, agentName: slug, exitCode: 1, artifact: null, posted: null, error: message, resultPath };
  }
}

export async function runCi(deps: RunCiDeps): Promise<RunCiResult> {
  const readFile = deps.readFile ?? readFileSync;
  const readDir = deps.readDir ?? readdirSync;
  const writeFile = deps.writeFile ?? writeFileSync;
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const fetchDiffImpl = deps.fetchDiff ?? fetchPrDiff;

  // Shared setup: locate EVERY manifest, resolve the PR context, and fetch the
  // diff ONCE (the same PR diff feeds every agent). A failure here is a whole-run
  // failure — no agent can review, so nothing is posted and no artifact written.
  let manifestPaths: string[];
  let ctx: PrContext;
  let diff: UnifiedDiff;
  let githubToken: string | undefined;
  try {
    manifestPaths = findManifestPaths(deps.devdigestDir, { readDir });
    ctx = resolvePrContext(deps.env, readFile);
    githubToken = deps.env.GITHUB_TOKEN;
    if (deps.postAs !== 'none' && !githubToken) {
      throw new RunnerError(`GITHUB_TOKEN is required to post as '${deps.postAs}'`);
    }
    // Strip DevDigest's own exported artifacts (`.devdigest/**`, the workflow)
    // BEFORE parse — the minified runner bundle would otherwise fail the review
    // with a GitHub 422 "diff too large", and reviewing our own config is noise.
    const rawDiff = await fetchDiffImpl(ctx, githubToken ?? '', fetchImpl);
    diff = parseUnifiedDiff(stripIgnoredFiles(rawDiff));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, agents: [], error: message };
  }

  // Per-agent loop — each isolated so a trip/hard-fail never stops the others.
  const agents: AgentRunResult[] = [];
  for (const manifestPath of manifestPaths) {
    const slug = manifestSlugFromPath(manifestPath);
    agents.push(
      await reviewAgent({
        manifestPath,
        slug,
        devdigestDir: deps.devdigestDir,
        ctx,
        diff,
        llm: deps.llm,
        postAs: deps.postAs,
        githubToken,
        resultPath: resultPathFor(deps.resultPath, slug),
        fetchImpl,
        readFile,
        writeFile,
        now,
      }),
    );
  }

  // Aggregate exit computed AFTER all agents ran (AC-61/AC-69).
  const exitCode = agents.some((a) => a.exitCode !== 0) ? 1 : 0;
  return { exitCode, agents };
}
