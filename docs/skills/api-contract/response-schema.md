# Response Schema

Flag changes to the SHAPE of a response that an existing caller has already
parsed: field presence, field types, and nullability/optionality. Callers
deserialize responses against an assumed schema — a shape change breaks them
even when the endpoint, method, and status code are untouched.

## Treat as breaking
- A field is **removed** or **renamed**.
- A field's **type** changes (`number` → `string`, object → array, scalar →
  object, enum value removed).
- A field that was **always present** becomes **optional/nullable** (callers
  that don't null-check now crash).
- An array's **element shape** changes, or an enum **drops/renames** a member a
  caller switches on.

## Non-breaking (do not flag)
- Adding a **new optional** field.
- **Loosening** a required input or **widening** an accepted enum on the request
  side.
- Making a previously-optional **response** field always present.

## Decision rule
- Ask: "Would a client decoding this JSON against the old schema fail or read a
  wrong value?" If yes → finding, citing `file:line` and the field. A response
  shape change that breaks callers requires a version bump — see
  `semver-discipline` — and the old shape should be deprecated, not dropped —
  see `deprecation-policy`.

## Example

❌ Bad — `total` flips from a number to a formatted string; `total * 1.2` now NaN:
```diff
- res.send({ total: 1999 })          // cents, number
+ res.send({ total: "$19.99" })      // formatted string
```

✅ Good — keep `total` stable, add the formatted value as a new optional field:
```diff
- res.send({ total: 1999 })
+ res.send({ total: 1999, total_display: "$19.99" })
```
