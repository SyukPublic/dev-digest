# Onion Architecture — good / bad examples

One ❌ Bad / ✅ Good pair per rule in [SKILL.md](SKILL.md), grounded in real
DevDigest paths. The Good column reflects how the code already works today —
follow it; the Bad column is the violation to catch in review.

---

## 1. Dependencies point inward — `reviewer-core` stays pure (CRITICAL)

❌ **Bad** — the core fetches the diff and reads the DB itself:
```ts
// reviewer-core/src/review/run.ts
import { simpleGit } from 'simple-git';            // I/O in the core
import { db } from '../../../server/src/db/client.js'; // and a back-edge to server!

export async function reviewPullRequest(input: ReviewInput) {
  const diff = await simpleGit().diff([input.base, input.head]); // fetches, not given
  const prior = await db.query.reviews.findMany();               // DB in the core
  // ...
}
```

✅ **Good** — the diff and provider are **inputs**; the only side effect is the injected LLM:
```ts
// reviewer-core/src/review/run.ts
export interface ReviewInput {
  systemPrompt: string;
  model: string;
  diff: UnifiedDiff;     // already parsed — an input, not fetched
  llm: LLMProvider;      // injected; the ONLY side effect
}
export async function reviewPullRequest(input: ReviewInput): Promise<Review> {
  const prompt = assemblePrompt(/* ... */);
  const res = await input.llm.completeStructured({ schema: ReviewSchema, /* ... */ });
  return groundFindings(res.data, input.diff); // pure
}
```
Whoever has the I/O (server / CI runner) loads the diff and passes it in.

---

## 2. External systems only behind interfaces (CRITICAL)

❌ **Bad** — a service imports and constructs a concrete SDK adapter:
```ts
// modules/reviews/service.ts
import { OpenAIProvider } from '../../adapters/llm/openai.js'; // concrete impl
export class ReviewService {
  private llm = new OpenAIProvider(process.env.OPENAI_API_KEY!); // unmockable
}
```

✅ **Good** — depend on the `LLMProvider` interface, resolved from the container:
```ts
// modules/reviews/service.ts
import type { Container } from '../../platform/container.js';
export class ReviewService {
  constructor(private container: Container) {}
  private async provider() {
    return this.container.llm('openrouter'); // returns LLMProvider (an interface)
  }
}
```
The interface lives in `server/src/vendor/shared/adapters.ts`; the only place that
names `OpenAIProvider` is the container.

---

## 3. Instantiate only in the composition root (HIGH)

❌ **Bad** — `new`-ing an adapter ad hoc inside a feature, bypassing overrides:
```ts
// modules/repos/service.ts
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
const github = new OctokitGitHubClient(token); // tests can't swap this
```

✅ **Good** — the container owns construction; tests inject via `ContainerOverrides`:
```ts
// platform/container.ts
async github(): Promise<GitHubClient> {
  if (this.overrides.github) return this.overrides.github;   // test seam
  const token = await this.secrets.get('GITHUB_TOKEN');
  if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
  return (this._github ??= new OctokitGitHubClient(token));
}

// in a test
const container = new Container(config, db, { github: new MockGitHubClient() });
```

---

## 4. All DB access lives in repositories (CRITICAL)

❌ **Bad** — Drizzle inside a service (and a leaked query builder):
```ts
// modules/reviews/service.ts
import { db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { eq } from 'drizzle-orm';

async listReviews(prId: string) {
  return db.select().from(t.reviews).where(eq(t.reviews.prId, prId)); // ORM in service
}
// even worse — returning the builder so callers keep chaining Drizzle:
reviewsQuery() { return db.select().from(t.reviews); }
```

✅ **Good** — the query lives in the repository; the service calls a named method:
```ts
// modules/reviews/repository/review.repo.ts
export async function reviewsForPull(db: Db, prId: string): Promise<ReviewRow[]> {
  return db.select().from(t.reviews)
    .where(eq(t.reviews.prId, prId))
    .orderBy(desc(t.reviews.createdAt));
}

// modules/reviews/service.ts
async listReviews(prId: string) {
  return this.repo.reviewsForPull(prId); // returns domain rows, not a builder
}
```

---

## 5. Zod contracts are the single source of truth at boundaries (HIGH)

❌ **Bad** — an ad-hoc inline shape, then re-validating the same data deeper in:
```ts
// modules/reviews/routes.ts
const body = req.body as { agentId?: string };          // unparsed, untyped trust
const targets = await service.resolveTargets(ws, body);
// ...and again inside the service:
if (typeof input.agentId !== 'string') throw new Error('bad'); // re-validation
```

✅ **Good** — parse once at the edge with a shared contract; inward code trusts the type:
```ts
// modules/reviews/routes.ts
import { RunRequest } from '@devdigest/shared';
const body = RunRequest.parse(req.body ?? {});           // parse, don't validate
const targets = await service.resolveTargets(workspaceId, body);
// service signature is typed from the contract — no re-checking inward
```
New contract? Add a **new file** under `vendor/shared/contracts/` and export it —
never edit the barrel.

---

## 6. Routes are a thin edge (HIGH)

❌ **Bad** — business logic, DB, and an adapter call all in the handler:
```ts
app.post('/pulls/:id/review', async (req) => {
  const agents = await db.select().from(t.agents);            // DB in route
  const gh = new OctokitGitHubClient(token);                  // adapter in route
  const enabled = agents.filter(a => a.enabled && a.model);   // logic in route
  // ...orchestrate the whole run here...
});
```

✅ **Good** — parse, delegate to one service call, return:
```ts
app.post('/pulls/:id/review',
  { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
  async (req) => {
    const { workspaceId } = await getContext(container, req);
    const body = RunRequest.parse(req.body ?? {});
    const targets = await service.resolveTargets(workspaceId, body);
    const { runs, reviews } = await service.runReview(workspaceId, req.params.id, targets, req.log);
    return { pr_id: req.params.id, runs, reviews };
  });
```

---

## 7. Respect facade boundaries (MEDIUM)

❌ **Bad** — deep-importing another subsystem's internal pipeline:
```ts
// modules/reviews/run-executor.ts
import { buildRepoMap } from '../repo-intel/pipeline/map-builder.js'; // internal!
const map = await buildRepoMap(repoId);
```

✅ **Good** — go through the published facade on the container:
```ts
// modules/reviews/run-executor.ts
const intel = await this.container.repoIntel.getMapAndCallers(repoId); // facade
```
Same for shared entities: `container.agentsRepo` / `container.reviewRepo`, not a
deep import into another module's `repository/`.

---

## 8. Cross-package import direction (HIGH)

❌ **Bad** — the center importing an outer package (a back-edge / cycle):
```ts
// reviewer-core/src/review/run.ts
import { Container } from '../../../server/src/platform/container.js'; // core → server
```
```ts
// vendor/shared/contracts/findings.ts
import { db } from '../../../db/client.js'; // shared must stay runtime-free
```

✅ **Good** — arrows point inward only:
```ts
// reviewer-core/src/review/run.ts
import type { LLMProvider, Review, UnifiedDiff } from '@devdigest/shared'; // → center
```
Allowed: `server → reviewer-core → @devdigest/shared`, and `server → @devdigest/shared`.
`@devdigest/shared` imports only `zod` and its own contracts.

---

## 9. Enforce the boundaries mechanically (HIGH)

A `dependency-cruiser` `forbidden` block that encodes the rules above
(`.dependency-cruiser.cjs`):
```js
module.exports = {
  forbidden: [
    { name: 'core-not-import-server', severity: 'error',
      from: { path: '^reviewer-core/src' },
      to:   { path: '^server/src' } },                                  // rule 8
    { name: 'shared-stays-pure', severity: 'error',
      from: { path: 'vendor/shared' },
      to:   { pathNot: ['vendor/shared', 'node_modules/zod'] } },       // rule 8
    { name: 'no-orm-outside-repositories', severity: 'error',
      from: { path: 'modules/.+/(routes|service)\\.ts$' },
      to:   { path: 'node_modules/drizzle-orm' } },                     // rule 4
    { name: 'no-concrete-adapters-in-services', severity: 'error',
      from: { path: ['modules/.+/service\\.ts$', '^reviewer-core/src'] },
      to:   { path: 'server/src/adapters/.+' } },                       // rule 2
    { name: 'repo-intel-only-via-facade', severity: 'error',
      from: { pathNot: 'modules/repo-intel' },
      to:   { path: 'modules/repo-intel/.+', pathNot: 'modules/repo-intel/(types|index)\\.ts$' } }, // rule 7
    { name: 'no-circular', severity: 'error',
      from: {}, to: { circular: true } },
  ],
  options: { tsConfig: { fileName: 'tsconfig.json' }, doNotFollow: { path: 'node_modules' } },
};
```
```jsonc
// server/package.json
{ "scripts": { "arch:check": "depcruise src --config .dependency-cruiser.cjs" } }
```
Run `pnpm arch:check` in CI. Adjust the path regexes to the actual layout before
committing; treat a new violation as a failing build, not a warning.
