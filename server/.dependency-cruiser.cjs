/**
 * Onion-architecture boundary enforcement for the DevDigest backend.
 *
 * Encodes the dependency rule as `forbidden` checks so the layering can't erode
 * silently (a check in CI doesn't drift the way a convention does). Run via
 * `pnpm arch:check`; a new violation is a failing build, not a warning.
 *
 * Rules map to the `onion-architecture` skill:
 *   - rule 4 — DB access only in repositories (no Drizzle / schema in routes/services)
 *   - rule 2 — external systems only behind interfaces (no concrete adapters in services/core)
 *   - rule 7 — respect facade boundaries (repo-intel + cross-module repositories)
 *   - no-circular — cycles are forbidden outright
 */
module.exports = {
  forbidden: [
    {
      name: 'no-orm-outside-repositories',
      comment: 'rule 4 — Drizzle query builder may only appear in repositories',
      severity: 'error',
      from: { path: 'src/modules/[^/]+/(routes|service)\\.ts$' },
      to: { path: 'node_modules/drizzle-orm' },
    },
    {
      name: 'no-schema-tables-outside-repositories',
      comment: 'rule 4 — the Drizzle table schema is a repository detail',
      severity: 'error',
      from: { path: 'src/modules/[^/]+/(routes|service)\\.ts$' },
      to: { path: 'src/db/schema(\\.ts|/)' },
    },
    {
      name: 'no-concrete-adapters-in-services',
      comment:
        'rule 2 — services/core depend on adapter INTERFACES (resolved from the ' +
        'container), never concrete impls. Exception-free: every external system ' +
        '(incl. astgrep / @ast-grep/napi) is reached through a container port.',
      severity: 'error',
      from: { path: ['src/modules/[^/]+/service\\.ts$', '^src/.*reviewer-core'] },
      to: { path: 'src/adapters/.+' },
    },
    {
      name: 'repo-intel-internals-only-via-facade',
      comment:
        'rule 7 — feature modules use container.repoIntel, never repo-intel pipeline/' +
        'service/repository internals. The composition root (platform/container) and ' +
        'module registry (modules/index) are outside this `from` scope, as are shared ' +
        'constants/types — those are legitimate cross-references.',
      severity: 'error',
      from: { path: 'src/modules/[^/]+', pathNot: 'src/modules/(repo-intel|index\\.ts$)' },
      to: { path: 'src/modules/repo-intel/(pipeline|repository\\.ts|service\\.ts)' },
    },
    {
      name: 'no-cross-module-repository',
      comment:
        'rule 7 — a module reaches another module only via its container facade, ' +
        'never by importing its repository directly (row types live in db/rows.ts)',
      severity: 'error',
      from: { path: 'src/modules/([^/]+)/' },
      to: { path: 'src/modules/(?!$1)[^/]+/repository' },
    },
    {
      name: 'no-circular',
      comment:
        'cycles couple layers. NOTE: warn (not error) — the hand-rolled DI passes the ' +
        'whole Container into services while the container constructs some of them ' +
        '(e.g. RepoIntelService), an intentional composition-root cycle. Surfaced so NEW ' +
        'accidental cycles get reviewed; promote to error if the DI is ever inverted.',
      severity: 'warn',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.test\\.ts$' },
  },
};
