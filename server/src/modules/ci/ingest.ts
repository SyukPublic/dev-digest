import { CiResultArtifact, type CiInstallation, type GitHubClient } from '@devdigest/shared';
import { ARTIFACT_NAME, WORKFLOW_FILENAME, parseRepoSlug } from './constants.js';
import type { CiRepository, CiRunUpsert } from './repository.js';

/**
 * Pull-on-refresh ingest (T17). For each installed repo it lists the
 * `devdigest-review.yml` workflow runs, downloads the result artifact, and
 * upserts an `agent_runs` row with `source='ci'`. Idempotent by
 * `(workspaceId, ciInstallationId, github_url)` — re-running never duplicates a
 * row (AC-38), and a still-running job (no artifact yet) becomes a `running` row
 * that is completed on a later refresh (AC-37).
 *
 * The downloaded artifact text is UNTRUSTED: it is `JSON.parse`d in a try/catch
 * and validated with `CiResultArtifact.safeParse`; malformed input is rejected
 * (skipped), never trusted as control input.
 *
 * Depends only on the `GitHubClient` PORT + the module's own repository (Onion).
 */

/** Map a workflow run's conclusion + finding count to a CI run status. */
function deriveStatus(conclusion: string | null, findingsCount: number): string {
  if (conclusion === 'failure' || conclusion === 'timed_out') return 'failed';
  if (findingsCount === 0) return 'no_findings';
  return 'succeeded';
}

export async function ingestCiRuns(params: {
  workspaceId: string;
  installations: CiInstallation[];
  github: GitHubClient;
  repo: CiRepository;
}): Promise<{ ingested: number }> {
  const { workspaceId, installations, github, repo } = params;
  let ingested = 0;

  for (const inst of installations) {
    // Only GitHub Actions installs have a workflow to poll.
    if (inst.target_type !== 'gha') continue;
    const ref = parseRepoSlug(inst.repo);
    const runs = await github.listWorkflowRuns(ref, WORKFLOW_FILENAME);

    for (const run of runs) {
      const githubUrl = run.htmlUrl;
      const existing = await repo.findRunByGithubUrl(workspaceId, inst.id, githubUrl);
      const ranAt = new Date(run.createdAt);

      const text = await github.downloadWorkflowRunArtifact(ref, run.runId, ARTIFACT_NAME);

      // No artifact yet → still running (or upload failed). Upsert a running row
      // so the UI shows it; a later refresh completes it (AC-38).
      if (text === null) {
        const running: CiRunUpsert = {
          workspaceId,
          agentId: inst.agent_id,
          ciInstallationId: inst.id,
          repo: inst.repo,
          githubUrl,
          prNumber: run.prNumber,
          status: 'running',
          ranAt,
        };
        if (existing) await repo.updateCiRun(existing.id, running);
        else {
          await repo.insertCiRun(running);
          ingested++;
        }
        continue;
      }

      // Untrusted artifact → parse defensively; reject malformed input.
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        continue;
      }
      const parsed = CiResultArtifact.safeParse(json);
      if (!parsed.success) continue;
      const a = parsed.data;

      const findings = a.findings_count;
      const values: CiRunUpsert = {
        workspaceId,
        agentId: inst.agent_id,
        ciInstallationId: inst.id,
        repo: inst.repo,
        githubUrl,
        prNumber: a.pr_number ?? run.prNumber,
        status: deriveStatus(run.conclusion, findings),
        ranAt,
        findingsCount: findings,
        // CRITICAL count → blockers, SUGGESTION count → suggestions; the CI Runs
        // UI derives its 3-way split (🔴 blockers / ⚠ remainder / 💡 suggestions)
        // from these, matching the PR review's per-severity counts.
        blockers: a.critical ?? null,
        suggestions: a.suggestion ?? null,
        costUsd: a.cost_usd, // persisted from the artifact, never recomputed
        durationMs: a.duration_ms ?? null,
      };
      if (existing) await repo.updateCiRun(existing.id, values);
      else {
        await repo.insertCiRun(values);
        ingested++;
      }
    }
  }

  return { ingested };
}
