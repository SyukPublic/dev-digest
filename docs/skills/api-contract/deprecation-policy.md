# Deprecation Policy

When a part of the public contract must go away, it must be DEPRECATED first,
not deleted in place. Flag any diff that silently removes or repurposes a
field/param/endpoint without a documented deprecation path — silent removal is
the breaking change `breaking-change` exists to catch.

## A correct deprecation
- **Keeps the old surface working** for a stated window — old and new coexist.
- **Marks** the old surface as deprecated where callers can see it: a doc/JSDoc
  `@deprecated` note, an OpenAPI `deprecated: true`, and ideally a runtime signal
  (`Deprecation` / `Sunset` response headers per RFC 8594, or a logged warning).
- **Names the replacement** and the **removal version/date**, so callers can
  migrate. The actual removal lands in a later MAJOR release — see
  `semver-discipline`.

## Treat as a finding
- A field/param/route **removed or renamed** with no prior deprecated period.
- A deprecation note with **no replacement** and **no removal version/date**
  (callers can't act on "this is going away, somehow, sometime").
- Behavior **repurposed** under the same name (same field, new meaning) — that's
  a silent break, worse than removal.

## Example

❌ Bad — endpoint deleted outright; integrators get a sudden 404:
```diff
- app.get('/v1/users/:id/avatar', getAvatar)
```

✅ Good — keep it, deprecate it, point to the replacement, set a sunset:
```diff
  app.get('/v1/users/:id/avatar', (req, res) => {
+   res.header('Deprecation', 'true')
+   res.header('Sunset', 'Sat, 31 Oct 2026 23:59:59 GMT') // removed in v2; use GET /v1/users/:id (field `avatar_url`)
    return getAvatar(req, res)
  })
```
