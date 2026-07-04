# run-plan — spawn-prompt templates

Fill every `{{placeholder}}`; drop a whole block only when marked optional.
Spawn prompts are English; `{{user_language}}` tells the agent what language to
write its report prose in. Embed content VERBATIM (context pack, findings,
design brief) — pass fragments, not pointers.

## 1. implementer — phase (Stage 1)

Agent: `implementer`, name `impl-p{{N}}`. One per phase; parallel within a wave.

```
Implement Phase {{N}} — "{{phase_title}}" of the Development Plan
{{plan_path}}.

Execution context (run-plan pipeline; your report goes to an orchestrator):
- Your phase, verbatim from the plan:
{{phase_block_verbatim}}
- Disjoint scope — you own ONLY these files/modules; do not touch anything else:
{{disjoint_scope}}
- Shared scaffold (context pack) — use these fragments; do NOT re-read their sources:
{{context_pack_verbatim}}
{{#if additional_prompt}}- Additional requirements from the user:
{{additional_prompt}}{{/if}}
{{#if design_brief}}- Design brief (verbalized from designs; images are NOT available to you):
{{design_brief}}{{/if}}

Rules for this run:
- Write code + tests for YOUR tasks ({{task_ids}}); a separate test-writer pass
  will fill remaining RTM test gaps afterwards — do not stray beyond your tasks.
- Do NOT tick plan checkboxes, do NOT commit/push, do NOT run migrations
  (flag if one becomes required).
- Report in your standard completion-report format, prose in {{user_language}}.
```

## 2. test-writer — gap pass (Stage 2)

Agent: `test-writer`, name `test-gap-pass`. One per run, after the last wave.

```
Test gap pass for the Development Plan {{plan_path}} (run-plan pipeline).

The implementation phases are complete. Audit the plan's Traceability matrix
Test column against the tests that ACTUALLY exist on disk:

{{rtm_table_verbatim}}

- For every RTM test with no existing (or only superficial) coverage, write it.
- Do NOT rewrite healthy tests the implementers already added; extend only
  where coverage of the mapped AC is missing or thin.
- Production files changed in this run (for orientation): {{changed_files}}
- Any production-code change you need → report as a follow-up (it will be
  routed to an implementer); never make it yourself.
- Report in your standard format, prose in {{user_language}}.
```

## 3. architecture-reviewer (Stage 4)

Agent: `architecture-reviewer`, name `arch-review`. Parallel with plan-verifier.

```
Architecture review of the run-plan changes for {{plan_path}}.

Scope: ALL uncommitted changes vs baseline {{baseline_sha}} — `git diff` plus
untracked files ({{changed_files}}). Audit ONLY this scope, not the whole repo.
Report prose in {{user_language}}.
```

## 4. plan-verifier (Stage 4)

Agent: `plan-verifier`, name `plan-verify`. Parallel with architecture-reviewer.

```
Verify the implementation against the Development Plan {{plan_path}}.

The plan was just executed; the changes are uncommitted in the working tree
(changed files: {{changed_files}}). Produce your standard RTM report — audit
the code as it is on disk. Report prose in {{user_language}}.
```

## 5. Fix iteration — implementer (Stage 5)

Prefer `SendMessage` to the owning `impl-p{{N}}` (context warm). Fresh fixer
(`implementer`, name `fix-iter{{K}}-{{group}}`) only when ownership is mixed or
the owner is gone. Same body either way:

```
Fix iteration {{K}} (run-plan pipeline) — findings from review, assigned to you
because they fall in your scope: {{group_scope}}.

Findings VERBATIM (evidence included — address the evidence, not a paraphrase):

{{findings_verbatim_with_evidence}}

Rules: stay inside {{group_scope}}; fix the findings and keep the affected
package's tests green; do not tick checkboxes / commit / migrate. Report files
changed + test result, prose in {{user_language}}.
```

## 6. Re-verify delta — SendMessage to a reviewer (Stage 5)

To `arch-review` and/or `plan-verify` — whichever produced the findings. Never
spawn a fresh full audit for a re-check.

```
Fix iteration {{K}} is applied. Re-check ONLY these findings of yours against
the updated working tree: {{finding_refs}}.
Changed since your review: {{delta_files}}.
For each: resolved | still-open (with fresh evidence). Do not re-audit anything
else; do not raise new findings unless the fix itself introduced a violation.
```
