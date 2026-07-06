# Pipeline run ledger

> One row per retro'd run; append-only (newest last). Written by the `workflow-retro` skill.
> Tokens include orchestrator + ALL subagents (deep mode); `hit%` = cache-read share of the
> prompt side; `wall` = agents wall-clock; `Σ agents` = summed agent durations; `factor` = Σ/wall.

| date | session | run | agents | in | out | cache-read | hit% | tools | err | wall | Σ agents | ∥max | factor | top action | report |
|------|---------|-----|--------|----|-----|------------|------|-------|-----|------|----------|------|--------|------------|--------|
| 2026-07-04 | a764c5c2 | feature: Project Context Folder (spec→plan→pipeline→publish) | 18 (8×impl, 3×researcher, 2×Explore, spec-creator, planner, test-writer, arch-rev, plan-verif) | 163.5k | 475.4k | 92.74M | 95% | 1064 | 12 | 4h18m | 6h06m* | 4 | 1.42* | balance phase sizes for wider waves | [retro](2026-07-04-project-context-folder.md) |
| 2026-07-05 | af9c1cdd | feature: Onboarding Generator (spec→plan→pipeline→publish) | 19 (7×impl, 4×researcher, 3×Explore, spec-creator, planner, test-writer, arch-rev, plan-verif) | 192.0k | 458.9k | 72.44M | 95.3% | 968 | 12 | 5h10m | 5h30m* | 5 | 1.07* | implementers: targeted tests only, full suite = green barrier | [retro](2026-07-05-onboarding-generator.md) |
| 2026-07-05 | e1e3cfec | feature: Why+Risk Brief (spec→plan→pipeline→publish) | 15 (8×impl, 2×Explore, spec-creator, planner, test-writer, arch-rev, plan-verif) | 152.2k | 421.6k | 71.89M | 95.8% | 837 | 5 | 3h55m | 4h59m* | 4 | 1.27* | i18n phase: depend only on key-adding phases | [retro](2026-07-05-why-risk-brief.md) |
| 2026-07-06 | 50804825 | refinement: Brief & Onboarding UI R1–R6 (spec→plan→pipeline→publish, 1st single-agent) | 6 (spec-creator, planner, 1×impl, test-writer, arch-rev, plan-verif) | 70.0k | 214.4k | 42.18M | 96.6% | 393 | 6 | 2h06m* | 1h07m | 2 | 0.53* | test-writer gap pass: targeted tests only | [retro](2026-07-06-brief-onboarding-ui-refinements.md) |
| 2026-07-06 | bd75fd78 | cleanup: English-only localization (proposal→plan→pipeline→publish, single-agent, no spec/test-writer) | 4 (planner, 1×impl, arch-rev, plan-verif) | 41.9k | 113.3k | 9.87M | 89.6% | 165 | 2 | 2h02m* | 58m | 2 | 0.47* | targeted-tests clause survives single-agent mode | [retro](2026-07-06-english-only-localization.md) |
| 2026-07-06 | f6bdf438 | delta: mandatory line-range in risk refs (spec-evolve→delta-plan→pipeline→publish×2, single-agent) | 6 (spec-creator, planner, 1×impl, test-writer, arch-rev, plan-verif) | 121.8k | 298.5k | 77.48M | 96.9% | 396 | 10 | 2h33m* | 2h21m* | 2 | 0.92* | pre-flight probe of e2e prereqs (browser launch + pnpm gate) | [retro](2026-07-06-mandatory-line-range.md) |
