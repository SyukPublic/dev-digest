import { CiResultArtifact, type GitHubClient } from '@devdigest/shared';
import { ARTIFACT_NAME, WORKFLOW_FILENAME, parseRepoSlug } from './constants.js';
import type { CiInstallationForIngest, CiRepository, CiRunUpsert } from './repository.js';
import { slugify, stableManifestSlug } from './serialize.js';

/**
 * Pull-on-refresh ingest (multi-agent, AC-64..AC-67). For each installed repo it
 * lists the `devdigest-review.yml` workflow runs and, for EACH run, downloads
 * every per-agent result file in the shared artifact and maps each result to ITS
 * OWN installation by the (untrusted) `CiResultArtifact.agent` identity — never
 * the old blind fan-out that attributed one shared result to every installation.
 * Each mapped run is upserted as an `agent_runs` row (source='ci') carrying that
 * agent's own findings/severity split/cost/duration/status and referencing that
 * agent's `agent_id` + `ci_installation_id`.
 *
 * Idempotent by `(workspaceId, ciInstallationId, github_url)` — repeated refresh
 * never duplicates a row (AC-67), and the running→complete transition is a
 * per-install update. An install with NO result file on a run: in-flight →
 * `running`; completed with an empty artifact or a multi-agent run missing its
 * file → `failed` for its OWN install (AC-66). EXCEPTION — a completed LEGACY
 * single-agent run (one un-suffixed `devdigest-result.json`, no per-agent files)
 * never fails the OTHER installs: they simply weren't in that single-agent
 * bundle, so no row is fabricated and any stale `failed` row is retracted.
 *
 * The `agent` identity is UNTRUSTED (attacker-influenceable CI output): each file
 * is `safeParse`d and mapped ONLY to a matching installation; an identity that
 * matches NO installation on the repo is SKIPPED (AC-65), never attached to an
 * arbitrary/other agent's installation.
 *
 * Depends only on the `GitHubClient` PORT + the module's own repository (Onion).
 */

/** Map a workflow run's conclusion + finding count to a CI run status. */
function deriveStatus(conclusion: string | null, findingsCount: number): string {
  if (conclusion === 'failure' || conclusion === 'timed_out') return 'failed';
  if (findingsCount === 0) return 'no_findings';
  return 'succeeded';
}

/**
 * Build the identity → installation index for one repo. Each installation is
 * keyed by its stable `manifestSlug` (the artifact identity emitted by the new
 * runner) plus deterministic fallbacks for legacy rows/bundles: the slugified
 * agent name (the legacy on-branch manifest basename), the backfill slug, and the
 * raw agent name (the identity old single-agent bundles emitted). The primary
 * slug is added first so two same-named agents (distinct slugs) never collide.
 */
function buildIdentityIndex(
  installs: CiInstallationForIngest[],
): Map<string, CiInstallationForIngest> {
  const index = new Map<string, CiInstallationForIngest>();
  const add = (key: string | null | undefined, inst: CiInstallationForIngest) => {
    if (key && !index.has(key)) index.set(key, inst);
  };
  for (const inst of installs) {
    add(inst.manifestSlug, inst);
    add(slugify(inst.agentName), inst);
    add(stableManifestSlug(inst.agentId, inst.agentName), inst);
    add(inst.agentName, inst);
  }
  return index;
}

export async function ingestCiRuns(params: {
  workspaceId: string;
  installations: CiInstallationForIngest[];
  github: GitHubClient;
  repo: CiRepository;
}): Promise<{ ingested: number }> {
  const { workspaceId, installations, github, repo } = params;
  let ingested = 0;

  // Group installations by repo — one workflow-run listing + artifact download per
  // repo, regardless of how many agents are installed on it.
  const byRepo = new Map<string, CiInstallationForIngest[]>();
  for (const inst of installations) {
    if (inst.targetType !== 'gha') continue; // only GHA installs have a workflow to poll
    const list = byRepo.get(inst.repo) ?? [];
    list.push(inst);
    byRepo.set(inst.repo, list);
  }

  for (const [repoSlug, repoInstalls] of byRepo) {
    const ref = parseRepoSlug(repoSlug);
    const index = buildIdentityIndex(repoInstalls);
    const runs = await github.listWorkflowRuns(ref, WORKFLOW_FILENAME);

    for (const run of runs) {
      const githubUrl = run.htmlUrl;
      const ranAt = new Date(run.createdAt);

      // Download EVERY per-agent result file in the shared artifact; each is
      // untrusted → `safeParse`d, malformed entries dropped.
      const files = await github.downloadWorkflowRunArtifactFiles(ref, run.runId, ARTIFACT_NAME);

      const matchedInstallIds = new Set<string>();
      for (const file of files) {
        let json: unknown;
        try {
          json = JSON.parse(file.text);
        } catch {
          continue;
        }
        const parsed = CiResultArtifact.safeParse(json);
        if (!parsed.success) continue;
        const a = parsed.data;

        // Map by the untrusted `agent` identity → its OWN installation. An
        // identity matching no installation on this repo is SKIPPED (AC-65).
        const inst = index.get(a.agent);
        if (!inst) continue;
        matchedInstallIds.add(inst.id);

        const findings = a.findings_count;
        const values: CiRunUpsert = {
          workspaceId,
          agentId: inst.agentId,
          ciInstallationId: inst.id,
          repo: inst.repo,
          githubUrl,
          prNumber: a.pr_number ?? run.prNumber,
          status: deriveStatus(run.conclusion, findings),
          ranAt,
          findingsCount: findings,
          // CRITICAL count → blockers, SUGGESTION count → suggestions (the CI Runs
          // 3-way severity split); persisted, never recomputed.
          blockers: a.critical ?? null,
          suggestions: a.suggestion ?? null,
          costUsd: a.cost_usd,
          durationMs: a.duration_ms ?? null,
        };
        const existing = await repo.findRunByGithubUrl(workspaceId, inst.id, githubUrl);
        if (existing) await repo.updateCiRun(existing.id, values);
        else {
          await repo.insertCiRun(values);
          ingested++;
        }
      }

      // Was this a LEGACY single-agent run? The old runner uploads ONE un-suffixed
      // `devdigest-result.json` and NO per-agent `devdigest-result-<slug>.json`
      // files. On such a run only the single agent in that bundle ran — every OTHER
      // installed agent simply was NOT part of it (its manifest isn't in this run's
      // checkout, e.g. the target repo still ships the old single-agent bundle while
      // >1 agent is installed in the studio). That is "not run here", NOT a failure.
      const perAgentFiles = files.filter((f) => /^devdigest-result-.+\.json$/.test(f.name));
      const legacySingleAgentRun =
        perAgentFiles.length === 0 && files.some((f) => f.name === 'devdigest-result.json');

      // Installs on this repo with NO result file for this run:
      //  - in-flight run (status !== 'completed') → a genuine `running` row a later
      //    refresh completes;
      //  - COMPLETED legacy single-agent run → this install was not in the bundle →
      //    NOT a failure: never fabricate a row, and RETRACT any stale `failed` row a
      //    previous ingest wrote for it (self-heals the false failure);
      //  - COMPLETED with an empty artifact (job crashed) OR a multi-agent run
      //    missing THIS agent's file → terminal FAILURE for its own install (AC-66),
      //    never left stuck `running`.
      for (const inst of repoInstalls) {
        if (matchedInstallIds.has(inst.id)) continue;
        const existing = await repo.findRunByGithubUrl(workspaceId, inst.id, githubUrl);

        if (run.status === 'completed' && legacySingleAgentRun) {
          if (existing) await repo.deleteCiRun(existing.id);
          continue;
        }

        const status = run.status === 'completed' ? 'failed' : 'running';
        const noArtifact: CiRunUpsert = {
          workspaceId,
          agentId: inst.agentId,
          ciInstallationId: inst.id,
          repo: inst.repo,
          githubUrl,
          prNumber: run.prNumber,
          status,
          ranAt,
        };
        if (existing) await repo.updateCiRun(existing.id, noArtifact);
        else {
          await repo.insertCiRun(noArtifact);
          ingested++;
        }
      }
    }
  }

  return { ingested };
}
