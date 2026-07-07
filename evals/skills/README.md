# Skill evals — shared setup

Harness-level conventions for evaluating the project's Claude Code skills
(`.claude/skills/<skill>/`). The eval **inputs live inside each skill** so the
skill ships as one self-contained folder; this directory holds only the shared
setup and the (gitignored) run outputs.

## Layout

```
.claude/skills/<skill>/
  evals/
    evals.json          # test cases: prompt, files, expectations (committed)
    fixtures/case-*/    # hermetic input trees, NO hint comments (committed)

evals/skills/
  README.md             # this file (committed)
  workspaces/<skill>/   # run outputs: reviews, grading, benchmarks (gitignored)
    iteration-<N>/
      eval-<name>/
        eval_metadata.json
        with_skill/outputs/review.md    + timing.json, grading.json
        without_skill/outputs/review.md + timing.json, grading.json
      benchmark.json
```

Formats (evals.json, grading.json, benchmark.json) follow the schemas of the
`skill-creator` plugin (`references/schemas.md` there) so its aggregation
script and eval viewer work as-is.

## How a run works

For every eval in `evals.json`, two runs execute the same prompt:

1. **Hermetic copy** — the eval's `fixtures/case-*/` tree is copied into a
   FRESH temporary directory per run (outside the repo). The agent under test
   sees only the fixture tree; missing sibling files are expected and must not
   be treated as findings.
2. **with_skill** — the agent is pointed at the skill folder and told to read
   `SKILL.md` (plus its reference files) before doing the task.
3. **without_skill (baseline)** — same prompt, no skill path; the agent is
   explicitly forbidden to use the Skill tool or read anything under any
   `.claude/` directory. This is what keeps the comparison honest — fixtures
   sit inside the skill folder, one `Read` away from the answers.
4. Both write `review.md`; a grader scores it against the eval's
   `expectations`, producing `grading.json`; runs are aggregated into
   `benchmark.json` (pass rate / time / tokens, with-skill vs baseline).

Known caveat (agent-driven runs): subagents inherit the repo's `CLAUDE.md`
context, which mentions the skills. The prohibition above prevents the
baseline from *reading* them; the residual prompt asymmetry is identical for
both configurations, so the delta still measures the skill body.

## Running

- **Interactive (today):** ask Claude Code to run the `skill-creator` eval
  loop for the target skill; it spawns the runs, grades, and opens the
  comparison viewer.
- **CI (planned):** a scripted runner (`claude -p` per run from a neutral cwd,
  same copy/grade/aggregate steps) so `pass_rate(with_skill)` can gate a PR.
  The fixture/eval formats above are already CI-ready; only the runner script
  is pending.

## Operational gotchas (learned 2026-07-07, iteration 1)

- `scripts/aggregate_benchmark.py` (skill-creator) requires an extra run level:
  `eval-*/<config>/run-N/grading.json`. Files placed flat in `<config>/` produce
  an **empty** benchmark that prints `Delta: +0.00` with no warning. Copy
  `grading.json` + `timing.json` into `run-1/` (keep `outputs/` at config level
  for the viewer).
- `eval-viewer/generate_review.py` crashes on a Windows cp1251 console
  (box-drawing chars). Set `PYTHONUTF8=1` (and `PYTHONIOENCODING=utf-8`) before
  launching. Default port is 3117.
- The viewer's "Submit All Reviews" may leave `feedback.json` at
  `{"reviews": [], "status": "in_progress"}` — treat empty feedback as approval
  and confirm with the user in chat rather than blocking on the file.

## Authoring rules for new evals

- Fixtures are **fictional but realistic**: real import paths, real class
  names, repo code style — but modules that don't exist in the repo.
- Plant a known number of violations per case (here: 3) and keep at least one
  clean file or decoy — graders must check for false positives, not only hits.
- **Never** put comments in fixtures that hint at the planted problems.
- Neutral case names (`case-a`, …) so directory names leak nothing.
- Expectations must be objectively checkable against `review.md` and should
  include at least one *project-specific* discriminator (the thing a skilled
  run knows but a generic one doesn't).
