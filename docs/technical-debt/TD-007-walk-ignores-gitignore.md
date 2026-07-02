# TD-007 — repo-intel file walk does not honor `.gitignore`

| | |
|---|---|
| **Area** | `server/` — repo-intel walk |
| **Severity** | LOW (over-walks ignored files; bounded by `EXCLUDED_DIRS`) |
| **Status** | `accepted` |
| **Surfaced by** | In-code `TODO(T3)` ([pipeline/walk.ts:17](../../server/src/modules/repo-intel/pipeline/walk.ts#L17)) |
| **Detected on** | branch `labs/l04`, recorded 2026-07-02 |
| **Owning skill** | `onion-architecture` (backend) / repo-intel domain |

## Summary

The index file walk does **not** apply `.gitignore` filtering. It uses a fixed
`EXCLUDED_DIRS` denylist instead
([constants.ts:16-26](../../server/src/modules/repo-intel/constants.ts#L16-L26) —
`node_modules`, `dist`, `build`, `coverage`, `.next`, `out`, `vendor`, `.git`),
and the walk's `TODO(T3)` records the deferral: wire the `ignore` npm package once
a new dep is accepted, OR honor `git ls-files` so `.gitignore` comes for free
([walk.ts:15-18](../../server/src/modules/repo-intel/pipeline/walk.ts#L15-L18)).

Consequence: repo-specific ignored paths (generated output, local artifacts,
anything a repo's own `.gitignore` excludes that isn't in `EXCLUDED_DIRS`) get
walked and parsed.

## Why it's accepted (for now)

- The `EXCLUDED_DIRS` denylist covers the **heaviest** directories
  (`node_modules`, build outputs), so the practical loss is small (per the walk's
  own note).
- `MAX_INDEXED_FILES` (5000) and `MAX_FILE_SIZE` bound the blast radius of
  over-walking; only supported extensions are parsed (`SUPPORTED_EXT`).
- Honoring `.gitignore` properly needs either a new dependency (`ignore`) or a
  `git ls-files` integration — deferred rather than added ad hoc.

## Risk if left unaddressed

- **Low.** At worst, some ignored files are parsed and pollute the symbol/reference
  tables (extra rows, slightly noisier blast, marginal extra index time). No
  correctness-critical or security impact.

## Paydown options (when a trigger fires)

- Layer `.gitignore` on the walk via the `ignore` package, OR drive the file list
  from `git ls-files` (gets `.gitignore` semantics for free and matches the repo's
  tracked set).

## Triggers to re-evaluate

- A repo where ignored files materially pollute the index or blow past
  `MAX_INDEXED_FILES`.
- A dependency addition (`ignore`) is accepted, or the walk is reworked to use
  `git ls-files`.
