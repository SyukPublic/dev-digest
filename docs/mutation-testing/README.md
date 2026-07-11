# Mutation testing — reviewer-core/src/grounding.ts (L06 bonus lab)

> Date: 2026-07-11 · Tool: StrykerJS 9.6.1 (`@stryker-mutator/core` + `@stryker-mutator/vitest-runner`) ·
> Runner: Vitest 2.1.9 · Node v22.23.0 · pnpm 11.9.0

Mutation testing is "an eval for your tests": the tool generates **mutants** — copies of the
source with one small logic swap each (`<` → `<=`, `&&` → `||`, `Math.max` → `Math.min`, …) —
and runs the test suite against every mutant. If no test fails, the mutant **survives**:
there exists a behavior change your tests cannot distinguish from the original. Line coverage
measures "this line executed"; mutation score measures "this line's behavior is asserted".

## Target

- **Module:** [`reviewer-core/src/grounding.ts`](../../reviewer-core/src/grounding.ts) — the
  citation-grounding gate (a core invariant: every diff-finding must cite a line inside a real
  diff hunk or be dropped) plus the L2-staleness helpers `anchorStatus` / `anchoredText`.
- **Why this file:** pure logic (no DB/network — fast, deterministic mutant runs), already
  covered by three test files, and dense in boundary logic where mutants love to survive.
- **Config:** [`reviewer-core/stryker.config.json`](../../reviewer-core/stryker.config.json) —
  `mutate: ["src/grounding.ts"]` limits mutation to the one file; `inPlace: true` is required
  because the Stryker sandbox copy breaks the `@devdigest/shared` → `../server/src/vendor/shared`
  relative alias; `plugins` lists the vitest runner explicitly (pnpm's strict `node_modules`
  defeats the default `@stryker-mutator/*` glob discovery).

## Results

| Run | Mutants | Killed | Timeout | Survived | No coverage | Mutation score |
|---|---|---|---|---|---|---|
| Before (`report-before/mutation.html`) | 116 | 87 | 2 | **15** | 12 | **76.72 %** |
| After one killing test (`report-after/mutation.html`) | 116 | 89 | 1 | **14** | 12 | **77.59 %** |

(The extra `+1` in *killed* besides the targeted mutant is a former *timeout* mutant that
flipped to *killed* — timeout/killed classification is timing-sensitive for loop mutants.)

Reproduce (this repo's WSL test mirror; see `CLAUDE.local.md` for why the mirror exists):

```bash
bash scripts/test-mirror.sh server exec node --version   # sync server + reviewer-core mirrors
cd ~/.devdigest-test-mirror/reviewer-core && pnpm exec stryker run
```

## Survivor analysis (before-run, 15 survived + 12 no-coverage)

| Cluster | Mutants | What survived | Why it survived | What would kill it |
|---|---|---|---|---|
| `buildLineIndex` branch pick, line 29 | 6 | `h.newLineNumbers && h.newLineNumbers.length > 0` → `if (true)`, `if (false)`, `\|\|`, `>= 0`, `<= 0`, `&& true` | Every fixture's `newLineNumbers` agrees exactly with the declared `newStart`/`newLines` range, so the explicit branch and the fallback branch produce identical line sets | A fixture where `newLineNumbers` is empty (falls back to the declared range) and one where `newLineNumbers` disagrees with the declared range |
| `rangeIntersects` normalization, lines 42–43 | 2 | `Math.min(start, end)` ↔ `Math.max(start, end)` swaps | No fixture passes a reversed range (`start_line > end_line`) that intersects a hunk | A reversed-range finding (e.g. `start=13, end=11`) expected to stay grounded |
| `groundFindings` file-absent gate, line 61 | 1 | `if (!filesInDiff.has(...))` → `if (false)` | Only exercised via `reviewPullRequest`, whose hallucinated finding is dropped by the *range* check anyway — same verdict, different reason | A direct `groundFindings` test: full-file kind (`secret_leak`) on a file absent from the diff must be **dropped** |
| `groundFindings` full-file exemption, line 66 | 1 | `if (isFullFile)` → `if (false)` | No direct test sends a full-file kind through `groundFindings` with an out-of-hunk range | A direct `groundFindings` test: `secret_leak` with range outside every hunk must be **kept** |
| Drop-reason text, line 78 | 1 | Reason template literal → ``` `` ``` | Nothing asserts the human-readable reason string | Low value — cosmetic; intentionally not chased |
| `anchorStatus` null-kind default, line 109 | 1 | `finding.kind ? FULL_FILE_KINDS.has(finding.kind) : false` → `: true` | The only null-kind test used a range *inside* a hunk, where both branches yield `'current'` | **← killed in this lab** (see below) |
| `anchoredText` ordering, line 148 | 3 | `.sort((a, b) => a - b)` dropped / comparator gutted | Fixtures insert lines in ascending order, so `Map` insertion order already equals sorted order | A diff with two hunks whose line numbers arrive out of ascending order |
| No-coverage block | 12 | Legacy fallback in `buildLineIndex` (lines 31–33) and the file-absent / full-file branches inside `groundFindings` (lines 59–68) | `groundFindings` has no direct unit-test file; it is only reached through `reviewPullRequest` with happy-path fixtures | A dedicated `grounding.test.ts` exercising the legacy-diff fallback and both `groundFindings` gates |

## Step 4 — the killed mutant

**Chosen survivor:** `BooleanLiteral` at `src/grounding.ts:109:73`, inside `anchorStatus`:

```diff
- const isFullFile = finding.kind ? FULL_FILE_KINDS.has(finding.kind) : false;
+ const isFullFile = finding.kind ? FULL_FILE_KINDS.has(finding.kind) : true;
```

**Why this one (real production risk):** under the mutant, any finding with `kind = null`
is treated as a full-file finding — `anchorStatus` returns `'current'` for it as long as the
file appears in the diff, even when its anchor lines are gone. The L2 staleness feature would
then never mark a no-kind finding as `'moved_out'`; stale review comments would keep showing
as current. The existing null-kind test could not see this because its range *hit* a hunk,
where both the original and the mutant return `'current'`.

**The killing test** ([`reviewer-core/test/anchor.test.ts`](../../reviewer-core/test/anchor.test.ts)):

```ts
it('returns moved_out for kind=null when the range misses every hunk (null is not full-file)', () => {
  const finding = f({ file: 'src/service.ts', start_line: 20, end_line: 22, kind: null });
  expect(anchorStatus(finding, DIFF)).toBe('moved_out');
});
```

Green on the original code (9/9 in `anchor.test.ts`, 109/109 across the reviewer-core suite);
the after-run reports the mutant as *killed* and it no longer appears in the survivor list.

## Conclusions

1. **Green tests ≠ good tests.** 100 % of the suite passed while 15 behavior-changing mutants
   went unnoticed. Coverage said the lines ran; mutation testing showed which behaviors were
   never *asserted*.
2. **Survivors cluster around untested equivalence, not random gaps.** All 15 survivors trace
   to three fixture blind spots: fixtures whose `newLineNumbers` always agree with the declared
   hunk range, no reversed ranges, and no direct `groundFindings` unit tests. One well-aimed
   fixture kills a whole cluster.
3. **"Check the checker" is the same principle one level down.** The lesson's evals check the
   LLM agent; here mutants check the tests. A survived mutant is a generated bug your
   verification layer failed to catch.
4. **100 % mutation score is not the goal.** The drop-reason string mutant is cosmetic, and
   several line-29 mutants are near-equivalent on realistic diffs. The value is in *reading*
   the survivor list and consciously deciding which ones represent real risk.
5. **Actionable follow-up (not done in this lab):** a direct `grounding.test.ts` for
   `groundFindings` (file-absent drop, full-file keep, legacy-diff fallback) would eliminate
   all 12 no-coverage mutants plus the two `if (false)` survivors — the single highest-leverage
   next test file for this module.

## Files

- `report-before/mutation.html` — interactive Stryker report before the new test (open in a browser).
- `report-after/mutation.html` — same report after the killing test landed.
- Both are self-contained single-file HTML snapshots copied from the WSL mirror
  (`~/.devdigest-test-mirror/reviewer-core/reports/mutation/`), which the next mirror
  sync would otherwise overwrite.
