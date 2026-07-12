# Harness Evals CI — Operator Manual

> **Scope:** this manual is for the human operator. It covers the per-PR GitHub
> Actions workflow that runs the harness evals (skills / subagents / workflow
> tier) on OpenRouter — how it decides what to run, how to pick models, how to
> watch a run and read its results, and **how to temporarily pause the whole
> suite while keeping its structure intact**. The workflow itself lives in
> [.github/workflows/evals.yml](../../.github/workflows/evals.yml); the change
> detector in [evals/scripts/ci-detect.mjs](../../evals/scripts/ci-detect.mjs);
> the harness it drives in [evals/README.md](../../evals/README.md).
>
> **Short version:** it runs itself on every PR that touches a skill, agent,
> `AGENTS.md`, or the harness. To pause it, set the repo Actions **variable**
> `EVALS_ENABLED` to `false` (§5). To run it by hand, use **Run workflow** (§3).

---

## Table of contents

1. [What it is and when it runs](#1-what-it-is-and-when-it-runs)
2. [Models and key (job parameters)](#2-models-and-key-job-parameters)
3. [Running it manually](#3-running-it-manually)
4. [Watching a run and reading results](#4-watching-a-run-and-reading-results)
5. [Temporarily disabling the suite (`EVALS_ENABLED`)](#5-temporarily-disabling-the-suite-evals_enabled)
6. [Re-enabling and making it blocking later](#6-re-enabling-and-making-it-blocking-later)

---

## 1. What it is and when it runs

On every pull request that changes a routed path (`.claude/skills/**`,
`.claude/agents/**`, `CLAUDE.md`, any `AGENTS.md`, `evals/**`, or the workflow
file itself) a `detect` job diffs `main...HEAD`, maps the changed artifacts via
`ci-detect.mjs`, and fans out a matrix:

| Changed | Job | Tier |
|---|---|---|
| a **skill** that has evals (`evals/skills/<name>/`) | `skills-evals` (one leg per skill) | content — OpenRouter-direct |
| an **agent** that has evals (`evals/agents/<name>/`) | `agents-evals` (one leg per agent) | tool — via the bundled LiteLLM proxy |
| `CLAUDE.md` / any `AGENTS.md` / any agent / `evals/src` | `workflow-evals` | workflow (activation / dispatch / contrast) |

A changed artifact **without** evals is **not** a failure — `detect` prints a
`SKIP <name> (no evals)` notice and simply does not schedule that leg.

**Everything is advisory** (`continue-on-error`) while the suite is being
stabilized: a red eval never blocks a merge. `typecheck` type-checks the eval
engine on every run.

PRs from forks do not receive the `OPENROUTER_API_KEY` secret, so the eval jobs
cannot call OpenRouter there — by design.

## 2. Models and key (job parameters)

Models are `workflow_dispatch` inputs with defaults; auto-PR runs use the
defaults. Change a default in the workflow file, or override per manual run
(§3):

| Input | Default | Used by |
|---|---|---|
| `skills_model` | `openai/gpt-4.1-mini` | content tier |
| `tool_model` | `google/gemini-2.5-flash` | tool tiers (must be dispatch-capable) |
| `judge_model` | `anthropic/claude-sonnet-4.6` | the LLM judge (a neutral, stronger family than the task models) |

Rules of thumb baked into the defaults: keep the task model a **different
family** from the judge (softens self-preference), and keep the tool model
**dispatch-capable** (measured: `google/gemini-2.5-flash` performs subagent
dispatch; several cheaper models do the work inline and fail the assert).

The **key** is the repo Actions **secret** `OPENROUTER_API_KEY` (Settings →
Secrets and variables → Actions → **Secrets**). A secret is the only safe
"parameter" for a key — `workflow_dispatch` inputs are not masked and would
leak it into run logs. Rotate it by editing the secret value.

## 3. Running it manually

GitHub UI: **Actions → workflow `evals` → Run workflow →** pick the branch, and
optionally override `skills_model` / `tool_model` / `judge_model`.

CLI:

```bash
gh workflow run evals.yml --ref <branch>
# with model overrides:
gh workflow run evals.yml --ref <branch> \
  -f skills_model=openai/gpt-4.1-mini \
  -f tool_model=google/gemini-2.5-flash \
  -f judge_model=anthropic/claude-sonnet-4.6
```

A manual run maps the **whole** artifact set (not a PR diff), so it exercises
every skill/agent that has evals plus the workflow tier. `workflow_dispatch`
also **bypasses the pause switch** (§5), so a manual run works even when the
suite is disabled for auto-PR.

> Manual dispatch requires the workflow file to exist on the repository's
> default branch — a GitHub limitation on `workflow_dispatch`.

## 4. Watching a run and reading results

```bash
gh run list --workflow=evals.yml -L 5      # recent runs + ids
gh run watch <run-id>                       # live stream until it finishes
gh run view  <run-id>                       # per-job summary
gh run view  <run-id> --log-failed          # logs of failed steps only
```

The `detect` job's **Step Summary** shows the routing decision and every
`SKIP` line.

**Reading a red (advisory) job.** Because the task models are cheap, some eval
reds are expected. Before suspecting the CI wiring, classify the failure:

- **Content / threshold miss** — the model's answer scored below the case
  threshold (e.g. `expected 0.6 to be greater than or equal to 0.7`). This is a
  model/case-quality signal, not an infra problem.
- **Infra / flake** — look in `--log-failed` for `429`, `rate limit`,
  `Reached maximum number of turns`, or `proxy`. Tool-tier dispatch can flake
  under OpenRouter rate limits; re-run the single job.

If none of those signatures appear, the red is a content/threshold signal —
leave it advisory, or tune the case (case authoring is separate work and is
gated by the repo's evals gate).

## 5. Temporarily disabling the suite (`EVALS_ENABLED`)

The whole suite is gated on a repository Actions **variable** named
`EVALS_ENABLED`. `detect` and `typecheck` carry
`if: ${{ vars.EVALS_ENABLED != 'false' || github.event_name == 'workflow_dispatch' }}`,
and every eval job `needs: detect` — so when `detect` is skipped, the matrix
jobs cascade-skip. Nothing is deleted; the structure stays intact.

> Set the variable on the repository whose Actions actually run this workflow —
> i.e. the PR's **base** repository (Actions read `vars.*` from the run's own
> repo, not from a fork). A variable set on a different fork/upstream has no
> effect.

**Disable (pause auto-PR runs):**

- UI: **Settings → Secrets and variables → Actions → Variables** tab → **New
  repository variable** → Name `EVALS_ENABLED`, Value `false`.
- CLI (token needs the *Variables: write* permission):
  ```bash
  gh variable set EVALS_ENABLED --body false -R <owner>/<repo>
  ```

With it off, PRs still trigger the workflow, but `detect` + `typecheck` skip and
the eval matrix cascade-skips — **no OpenRouter tokens are spent**.

**Re-enable:**

```bash
gh variable set EVALS_ENABLED --body true -R <owner>/<repo>
# or remove it entirely — unset is treated as enabled (the default):
gh variable delete EVALS_ENABLED -R <owner>/<repo>
```

**Run it anyway while disabled:** use **Run workflow** / `gh workflow run`
(§3) — the guard exempts `workflow_dispatch`.

> **Alternative (no file, whole-workflow off):** `gh workflow disable evals.yml`
> / `gh workflow enable evals.yml` toggles the entire workflow from the Actions
> side. Simpler, but it also blocks manual dispatch and is not visible in the
> workflow file. Prefer `EVALS_ENABLED` when you want manual runs to keep
> working and the toggle to be self-documented.

## 6. Re-enabling and making it blocking later

Once the suite proves stable and its reds are trustworthy, promote it from
advisory to blocking:

- Drop `continue-on-error: true` from `skills-evals` and `typecheck` so their
  reds block a merge. Keep `agents-evals` and `workflow-evals` **advisory** —
  tool-tier dispatch flakes under OpenRouter rate limits, so a red there is not
  a reliable merge signal.
- Optionally mark the promoted jobs as **required status checks** in the branch
  protection rules for `main`.

Leave the `EVALS_ENABLED` switch in place — it is orthogonal to blocking and
remains the fastest way to pause the suite during noisy periods.
