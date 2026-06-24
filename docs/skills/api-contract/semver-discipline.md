# SemVer Discipline

Decide whether a contract change is correctly versioned under Semantic
Versioning 2.0.0 (https://semver.org). When the diff carries a breaking contract
change, a MAJOR bump (or a new versioned route) is REQUIRED — flag any breaking
change shipped under a MINOR/PATCH bump.

## When each level is required
- **MAJOR** (`X`.y.z) — any backward-INCOMPATIBLE change to the public API:
  removed/renamed/retyped field or param, changed method/path/status code,
  tightened input. See `breaking-change` and `response-schema`.
- **MINOR** (x.`Y`.z) — backward-COMPATIBLE additions: new endpoint, new
  optional field, new accepted input. Existing callers keep working.
- **PATCH** (x.y.`Z`) — backward-compatible bug fixes only; no contract change.
- Pre-1.0 (`0.y.z`): the API is unstable and anything MAY change — but say so;
  don't let a `0.x` excuse a silent break callers rely on.

## Decision rule
- Map the change → required level, then compare to the bump in the diff
  (`package.json` version, an OpenAPI `info.version`, or a `/v2` route).
- Breaking change + non-MAJOR bump → finding. The fix is either a MAJOR bump /
  new version, or keeping the old contract via `deprecation-policy`.
- Never reuse a version number for a changed contract.

## Example

❌ Bad — a removed field shipped as a PATCH; callers break on a "bugfix" release:
```diff
  // 1.4.2 → 1.4.3   (response drops `legacy_id`)
- "version": "1.4.2"
+ "version": "1.4.3"
```

✅ Good — the same removal shipped as a MAJOR bump:
```diff
  // 1.4.2 → 2.0.0   (response drops `legacy_id`)
- "version": "1.4.2"
+ "version": "2.0.0"
```
