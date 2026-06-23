# Breaking Change

Flag any change that removes, renames, or retypes part of a route's PUBLIC
contract — the shape an existing caller already depends on. For each, return a
finding citing the route and what would break for callers who do NOT change
their code.

## Treat as breaking
- A path/query/body parameter is **removed**, **renamed**, or **retyped**
  (e.g. `string` → `number`, optional → required).
- A new **required** request field, or a new required header, is added.
- The **HTTP method** or **route path** of an existing endpoint changes.
- A success/error **status code** changes (e.g. `200` → `204`, `400` → `422`).
- A response field a caller reads is **removed** or **renamed**.

## Decision rule
- A change is breaking **iff** an existing client stops working without editing
  its code. If yes → finding. If a migration is unavoidable, the fix is
  versioning + deprecation, never a silent swap. See `semver-discipline` and
  `deprecation-policy`.
- Purely **additive** changes (a new endpoint, a new *optional* field, a wider
  accepted input) are NOT breaking — do not flag them.

## Example

❌ Bad — renames a live response field; every caller reading `user_name` breaks:
```diff
- res.send({ user_name: u.name })
+ res.send({ name: u.name })
```

✅ Good — keep the old field, add the new one, deprecate the old (non-breaking):
```diff
- res.send({ user_name: u.name })
+ res.send({ user_name: u.name, name: u.name }) // user_name deprecated, removed in v2
```
