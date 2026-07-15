import type { Container } from '../../platform/container.js';
import type {
  CiExport,
  CiExportRequest,
  CiFile,
  CiInstallation,
  CiRunSummary,
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
  parseRepoSlug,
} from './constants.js';
import {
  buildManifest,
  buildSkillFiles,
  findManifestFile,
  manifestToYaml,
  parseManifestYaml,
  slugify,
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

    // Always regenerate the full bundle here (the non-editable runner is read from
    // disk in `generateFiles`, so it never has to round-trip in the request body — a
    // ~1.6 MB ncc bundle would blow the 1 MB `bodyLimit`). Overlay the caller's files
    // by path, so Step-2 edits to the editable files (manifest/workflow/skills) are
    // still honored verbatim (AC-6) while the client only sends the editable ones.
    const generated = await this.generateFiles(agentId, agent, req);
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

    // Persist the installation (idempotent per agent+repo — AC-10).
    const installation =
      (await this.repo.findInstallation(agentId, req.repo)) ??
      (await this.repo.insertInstallation({
        agentId,
        repo: req.repo,
        targetType: req.target,
      }));

    return { installation, files, pr_url: pr.url };
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
      agentSlug: slugify(agent.name),
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

  /** Pull-on-refresh ingest across every installed repo in the workspace (T17). */
  async ingest(workspaceId: string): Promise<{ ingested: number }> {
    const installations = await this.repo.listInstallationsForWorkspace(workspaceId);
    if (installations.length === 0) return { ingested: 0 };
    // Throws ConfigError when GITHUB_TOKEN is unset (AC-43) — no partial ingest.
    const github = await this.container.github();
    return ingestCiRuns({ workspaceId, installations, github, repo: this.repo });
  }
}
