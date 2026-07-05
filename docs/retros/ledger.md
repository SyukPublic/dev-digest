# Pipeline run ledger

> One row per retro'd run; append-only (newest last). Written by the `workflow-retro` skill.
> Tokens include orchestrator + ALL subagents (deep mode); `hit%` = cache-read share of the
> prompt side; `wall` = agents wall-clock; `Σ agents` = summed agent durations; `factor` = Σ/wall.

| date | session | run | agents | in | out | cache-read | hit% | tools | err | wall | Σ agents | ∥max | factor | top action | report |
|------|---------|-----|--------|----|-----|------------|------|-------|-----|------|----------|------|--------|------------|--------|
| 2026-07-04 | a764c5c2 | feature: Project Context Folder (spec→plan→pipeline→publish) | 18 (8×impl, 3×researcher, 2×Explore, spec-creator, planner, test-writer, arch-rev, plan-verif) | 163.5k | 475.4k | 92.74M | 95% | 1064 | 12 | 4h18m | 6h06m* | 4 | 1.42* | balance phase sizes for wider waves | [retro](2026-07-04-project-context-folder.md) |
| 2026-07-05 | af9c1cdd | feature: Onboarding Generator (spec→plan→pipeline→publish) | 19 (7×impl, 4×researcher, 3×Explore, spec-creator, planner, test-writer, arch-rev, plan-verif) | 192.0k | 458.9k | 72.44M | 95.3% | 968 | 12 | 5h10m | 5h30m* | 5 | 1.07* | implementers: targeted tests only, full suite = green barrier | [retro](2026-07-05-onboarding-generator.md) |
| 2026-07-05 | e1e3cfec | feature: Why+Risk Brief (spec→plan→pipeline→publish) | 15 (8×impl, 2×Explore, spec-creator, planner, test-writer, arch-rev, plan-verif) | 152.2k | 421.6k | 71.89M | 95.8% | 837 | 5 | 3h55m | 4h59m* | 4 | 1.27* | i18n phase: depend only on key-adding phases | [retro](2026-07-05-why-risk-brief.md) |
