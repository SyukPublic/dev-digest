import type { Container } from '../../platform/container.js';
import type {
  CiExport,
  CiExportRequest,
  CiFile,
  CiInstallation,
  CiRunSummary,
  CiUninstallResult,
  Provider,
  ReviewStrategy,
  CiFailOn,
} from '@devdigest/shared';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { CiRepository, type CiRunFilters } from './repository.js';
import { assembleBundle } from './bundle.js';
import { generateWorkflow } from './workflow.js';
import { ingestCiRuns } from './ingest.js';
import {
  CI_BRANCH,
  CI_PR_BODY,
  CI_PR_TITLE,
  CI_UNINSTALL_MESSAGE,
  MEMORY_PATH,
  RUNNER_PATH,
  WORKFLOW_PATH,
  parseRepoSlug,
} from './constants.js';
import {
  buildManifest,
  buildSkillFiles,
  findManifestFile,
  manifestPath,
  manifestToYaml,
  parseManifestYaml,
  skillPath,
  slugify,
  stableManifestSlug,
} from './serialize.js';

/**
 * CI service (T14–T19) — the studio-side producer + ingest. Thin orchestration:
 * builds the bundle via the pure serializer/workflow helpers, reaches GitHub only
 * through the `container.github()` PORT, and persists via the module repository.
 * No `fs` here (that lives in `bundle.ts`) and no direct octokit.
 */
export class CiService {
  private repo: CiRepository;

  constructor(private container: Container) {
    this.repo = new CiRepository(container.db);
  }

  /**
   * Export an agent to CI (T14/T15). `action=files` returns a preview bundle and
   * persists NOTHING; `action=open_pr` commits the bundle to `devdigest/ci` as
   * ONE atomic commit, opens/reuses a PR, and persists a `CiInstallation`.
   * Edited `files` (AC-6) are carried verbatim after re-validating the manifest
   * still round-trips `AgentManifest` (AC-4).
   */
  async export(
    workspaceId: string,
    agentId: string,
    req: CiExportRequest,
  ): Promise<CiExport> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    // Resolve the STABLE, per-agent-unique manifest slug for THIS (agent, repo)
    // (AC-62). On re-export reuse the row's stored slug so the path is stable even
    // after a rename; a legacy row (null slug) keeps its existing on-branch path
    // `slugify(name)` (no orphaned duplicate manifest); a fresh install mints a
    // unique `slugify(name)-<agentId prefix>`.
    const existingRow = await this.repo.findInstallationRow(agentId, req.repo);
    const manifestSlug =
      existingRow?.manifestSlug ??
      (existingRow ? slugify(agent.name) : stableManifestSlug(agentId, agent.name));

    // Always regenerate the full bundle here (the non-editable runner is read from
    // disk in `generateFiles`, so it never has to round-trip in the request body — a
    // ~1.6 MB ncc bundle would blow the 1 MB `bodyLimit`). Overlay the caller's files
    // by path, so Step-2 edits to the editable files (manifest/workflow/skills) are
    // still honored verbatim (AC-6) while the client only sends the editable ones.
    const generated = await this.generateFiles(agentId, agent, req, manifestSlug);
    const overrides = new Map((req.files ?? []).map((f) => [f.path, f]));
    const files = generated.map((f) => overrides.get(f.path) ?? f);

    // Re-validate the manifest round-trips the shared contract BEFORE committing
    // (covers both generated and user-edited bundles — AC-4/AC-6).
    const manifestFile = findManifestFile(files);
    if (!manifestFile) {
      throw new ValidationError('CI bundle is missing the agent manifest (.devdigest/agents/*.yaml).');
    }
    parseManifestYaml(manifestFile.contents);

    if (req.action === 'files') {
      // Preview only: no GitHub call, no installation persisted (AC-11).
      const preview: CiInstallation = {
        id: '',
        agent_id: agentId,
        repo: req.repo,
        target_type: req.target,
        installed_at: new Date().toISOString(),
      };
      return { installation: preview, files, pr_url: null };
    }

    // action === 'open_pr' — commit + PR. `container.github()` throws ConfigError
    // when GITHUB_TOKEN is unset (AC-43); we call it BEFORE persisting anything,
    // so an unconfigured token yields NO partial install.
    const github = await this.container.github();
    const ref = parseRepoSlug(req.repo);

    // ONE atomic commit onto devdigest/ci (created from base if missing). NEVER
    // commits to base, NEVER auto-merges (AC-9).
    await github.commitFiles(ref, {
      branch: CI_BRANCH,
      base: req.base,
      message: CI_PR_TITLE,
      files,
    });

    // Reuse the open PR if one already exists (idempotent re-publish — AC-8).
    const existingPr = await github.findOpenPr(ref, CI_BRANCH);
    const pr =
      existingPr ??
      (await github.openPullRequest(ref, {
        title: CI_PR_TITLE,
        head: CI_BRANCH,
        base: req.base,
        body: CI_PR_BODY,
      }));

    // Persist the installation (idempotent per agent+repo — AC-10/AC-57). Re-export
    // reuses the existing row (backfilling a legacy null slug so uninstall/ingest
    // can recover the manifest path); a first export inserts with the minted slug.
    let installation: CiInstallation;
    if (existingRow) {
      if (existingRow.manifestSlug == null) {
        await this.repo.setManifestSlug(existingRow.id, manifestSlug);
      }
      installation = (await this.repo.findInstallation(agentId, req.repo))!;
    } else {
      installation = await this.repo.insertInstallation({
        agentId,
        repo: req.repo,
        targetType: req.target,
        manifestSlug,
      });
    }

    return { installation, files, pr_url: pr.url };
  }

  /**
   * Remove an agent from a repo's CI (AC-70..AC-74). Deletes ONLY this agent's
   * manifest + its no-longer-referenced skill files from `devdigest/ci` (AC-71),
   * and when it is the LAST agent on the repo also removes the now-orphaned
   * workflow/runner/memory (AC-72) — but never the branch or the export PR. The
   * GitHub branch write happens BEFORE the DB row delete so an unset
   * `GITHUB_TOKEN` (ConfigError) or a branch error surfaces WITHOUT leaving the
   * studio row and the branch silently divergent (AC-74). Prior CI run history is
   * preserved as detached rows via the existing `set null` cascade (AC-73).
   */
  async uninstall(
    workspaceId: string,
    agentId: string,
    installationId: string,
  ): Promise<CiUninstallResult | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const inst = await this.repo.findInstallationById(agentId, installationId);
    if (!inst) return undefined;

    // Non-GHA stubs have no workflow/branch to clean — just drop the row.
    if (inst.targetType !== 'gha') {
      const removed = await this.repo.deleteInstallation(agentId, installationId);
      return {
        removed,
        repo: inst.repo,
        agent_id: agentId,
        branch_updated: false,
        pr_url: null,
        last_agent_removed: false,
      };
    }

    // Which other agents still remain on this repo (drives last-agent teardown +
    // which skill files are still referenced and must be kept).
    const onRepo = await this.repo.listInstallationRowsForRepo(workspaceId, inst.repo);
    const remaining = onRepo.filter((r) => r.id !== inst.id);
    const lastAgent = remaining.length === 0;

    // This agent's own files. The manifest path is its stored stable slug (legacy
    // rows fall back to their on-branch `slugify(name)` path).
    const slug = inst.manifestSlug ?? slugify(agent.name);
    const removedSkillSlugs = await this.agentSkillSlugs(agentId);

    // Skill files still referenced by a remaining agent are KEPT (skill files are
    // shared by slug across agents) — delete only the removed agent's skills that
    // no remaining agent references (AC-71).
    const keepSlugs = new Set<string>();
    for (const r of remaining) {
      for (const s of await this.agentSkillSlugs(r.agentId)) keepSlugs.add(s);
    }
    const orphanedSkillPaths = removedSkillSlugs
      .filter((s) => !keepSlugs.has(s))
      .map((s) => skillPath(s));

    const paths = [manifestPath(slug), ...orphanedSkillPaths];
    // Last agent → remove the now-orphaned workflow/runner/memory so PRs don't
    // fail on a workflow with zero manifests; NEVER the branch or the PR (AC-72).
    if (lastAgent) paths.push(WORKFLOW_PATH, RUNNER_PATH, MEMORY_PATH);

    // `container.github()` throws ConfigError when GITHUB_TOKEN is unset (AC-74),
    // BEFORE any mutation — so the row is never deleted on a missing token.
    const github = await this.container.github();
    const ref = parseRepoSlug(inst.repo);

    // GitHub write FIRST (AC-74): if it throws, the row stays and studio+branch do
    // not diverge. A branch/API failure propagates as a clear error to the route.
    await github.deleteFiles(ref, {
      branch: CI_BRANCH,
      // `base` is unused for a delete (the branch already exists; its tip is the
      // parent) — pass the branch itself so we never fork-from/touch a base.
      base: CI_BRANCH,
      message: CI_UNINSTALL_MESSAGE,
      paths,
    });

    // Branch is consistent — now delete the row. Run history detaches via the
    // existing `agent_runs.ci_installation_id onDelete: set null` cascade (AC-73).
    const removed = await this.repo.deleteInstallation(agentId, installationId);

    // The reused export PR (if still open) is left for the user (AC-72).
    const pr = await github.findOpenPr(ref, CI_BRANCH);

    return {
      removed,
      repo: inst.repo,
      agent_id: agentId,
      branch_updated: true,
      pr_url: pr?.url ?? null,
      last_agent_removed: lastAgent,
    };
  }

  /** The `.devdigest/skills/<slug>.md` slugs an agent's manifest would reference. */
  private async agentSkillSlugs(agentId: string): Promise<string[]> {
    const linked = await this.container.agentsRepo.linkedSkills(agentId);
    return buildSkillFiles(linked.map((l) => ({ name: l.skill.name, body: l.skill.body }))).map(
      (s) => s.slug,
    );
  }

  /** Build the 6-file bundle from an agent's config + linked skills. */
  private async generateFiles(
    agentId: string,
    agent: {
      name: string;
      provider: string;
      model: string;
      systemPrompt: string;
      strategy: string;
      ciFailOn: string;
    },
    req: CiExportRequest,
    manifestSlug: string,
  ): Promise<CiFile[]> {
    const linked = await this.container.agentsRepo.linkedSkills(agentId);
    const skillFiles = buildSkillFiles(
      linked.map((l) => ({ name: l.skill.name, body: l.skill.body })),
    );
    const manifest = buildManifest({
      name: agent.name,
      provider: agent.provider as Provider,
      model: agent.model,
      system_prompt: agent.systemPrompt,
      strategy: agent.strategy as ReviewStrategy,
      ci_fail_on: agent.ciFailOn as CiFailOn,
      skills: skillFiles.map((s) => s.slug),
    });
    const workflowYaml = generateWorkflow({ triggers: req.triggers, postAs: req.post_as });
    return assembleBundle({
      // Stable, per-agent-unique manifest path (AC-62) — no longer the raw
      // `slugify(name)`, which two agents could collide on / a rename would move.
      agentSlug: manifestSlug,
      manifestYaml: manifestToYaml(manifest),
      skillFiles,
      workflowYaml,
    });
  }

  /** Workspace CI-runs list (AC-32/AC-35). */
  async listCiRuns(workspaceId: string, filters: CiRunFilters): Promise<CiRunSummary[]> {
    return this.repo.listCiRuns(workspaceId, filters);
  }

  /** CI runs for one agent (AC-32) — workspace-scoped via the agent guard. */
  async listAgentCiRuns(workspaceId: string, agentId: string): Promise<CiRunSummary[] | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    return this.repo.listCiRuns(workspaceId, { agentId });
  }

  /** Per-repo installations for one agent's CI tab (AC-31). */
  async listInstallations(
    workspaceId: string,
    agentId: string,
  ): Promise<CiInstallation[] | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    return this.repo.listInstallationsForAgent(agentId);
  }

  /** Pull-on-refresh ingest across every installed repo in the workspace (multi-agent). */
  async ingest(workspaceId: string): Promise<{ ingested: number }> {
    // Rows enriched with `manifestSlug` + `agentName` so ingest can map each
    // per-agent result to its OWN installation by identity (AC-64/AC-65).
    const installations = await this.repo.listInstallationsForIngest(workspaceId);
    if (installations.length === 0) return { ingested: 0 };
    // Throws ConfigError when GITHUB_TOKEN is unset (AC-43) — no partial ingest.
    const github = await this.container.github();
    return ingestCiRuns({ workspaceId, installations, github, repo: this.repo });
  }
}
