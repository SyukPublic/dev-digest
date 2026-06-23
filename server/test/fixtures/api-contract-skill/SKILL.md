# API Contract Review

Flag any change that breaks an existing route's contract for callers. For each,
return a finding citing the affected route and the migration impact.

## Breaking changes
- Renamed, removed, or retyped path/query parameters.
- Changed request or response JSON shape (removed/renamed fields, changed types).
- Changed HTTP method, or success/error status codes.

## Guidance
- A change is breaking if an existing client would stop working without code changes.
- Additive changes (new optional field, new endpoint) are NOT breaking — don't flag them.
