# Pipeline run ledger

> One row per retro'd run; append-only (newest last). Written by the `workflow-retro` skill.
> Tokens include orchestrator + ALL subagents (deep mode); `hit%` = cache-read share of the
> prompt side; `wall` = agents wall-clock; `Σ agents` = summed agent durations; `factor` = Σ/wall.

| date | session | run | agents | in | out | cache-read | hit% | tools | err | wall | Σ agents | ∥max | factor | top action | report |
|------|---------|-----|--------|----|-----|------------|------|-------|-----|------|----------|------|--------|------------|--------|
