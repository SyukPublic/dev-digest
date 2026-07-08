import type { SkillCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// This skill decides WHERE backend code lives (layers + dependency direction). "quality" cases
// run content-only (skillTask, no tools — see tasks.ts), so each prompt inlines the code under
// review the way dependency-checker inlines its repo data. Fixtures are adapted from the skill's
// own hermetic eval set (.claude/skills/onion-architecture/evals/fixtures/): each review case
// carries 3 planted violations plus one clean file as a false-positive control, and the prompts
// stay neutral (no onion/layer vocabulary beyond a natural user ask) so eval:benchmark measures
// honest lift over the raw model.

const REVIEW_TASK = `The code below is provided inline — treat it as already read and answer directly in your reply (do not ask for tool access or more files).

For each issue report: the file, the offending line(s) or code, why it is a problem in this codebase's architecture, a severity, and the concrete fix you would make. If a file is clean, say so explicitly.`;

const file = (path: string, fixture: string) => `### ${path}\n\n\`\`\`ts\n${fx(fixture)}\n\`\`\``;

export const cases: SkillCase[] = [
  {
    name: "service review finds the 3 planted layering violations and spares the sanctioned patterns",
    kind: "quality",
    prompt: `I've drafted a first version of a notifications module for the DevDigest server (Fastify + Drizzle + Zod; the pure review engine lives in the separate reviewer-core package). Before I wire up the routes, review the layering and placement of what's there: does every piece of code live where it should?

${REVIEW_TASK}

${file("server/src/modules/notifications/service.ts", "notifications-service.ts")}

${file("server/src/modules/notifications/repository.ts", "notifications-repository.ts")}`,
    practices: [
      "flags the inline Drizzle query (select/from/where on t.notifications) inside NotificationsService.listUnread as DB access outside the repository layer, and the fix moves it into NotificationsRepository (whose listUnread already exists)",
      "flags the construction of OctokitGitHubClient (with its process.env.GITHUB_TOKEN read) inside the service, and the fix is to depend on a GitHub client interface resolved from the DI container instead of instantiating the concrete adapter in the service",
      "flags the import and construction of AgentsRepository (another module's repository) inside the service, and the fix reaches agents through the container facade (container.agentsRepo)",
      "does NOT flag `new NotificationsRepository(container.db)` in the service constructor as a violation — a module's service constructing its OWN repository from the container's db is a sanctioned pattern in this codebase",
      "reports no finding of severity MEDIUM or higher against repository.ts (the clean file); low-severity style notes are tolerated",
      "every reported finding carries an explicit severity, and the DB-in-service and concrete-adapter findings are ranked at least as severe as the cross-module repository finding",
    ],
    threshold: 0.7,
  },
  {
    name: "route review pushes validation to a Zod edge, logic to a service, and queries to repositories",
    kind: "quality",
    prompt: `Here's a draft GitHub webhook receiver for the DevDigest server (Fastify + Drizzle + Zod). Review the architecture of the route before I register it in modules/index.ts — I care about whether the responsibilities are in the right layer.

${REVIEW_TASK}

${file("server/src/modules/webhooks/routes.ts", "webhooks-routes.ts")}

${file("server/src/modules/webhooks/repository.ts", "webhooks-repository.ts")}`,
    practices: [
      "flags the `req.body as {...}` type-cast, and the fix parses the payload once at the edge with a Zod schema (e.g. a route schema via fastify-type-provider-zod or a shared contract) instead of casting",
      "notes that once the payload is parsed at the edge, the scattered ad-hoc typeof re-checks become redundant — parse once at the boundary and trust the parsed type inward",
      "flags the pull-request status mapping / orchestration logic in the handler as business logic living in the route, and the fix moves it into a service method so the handler stays thin (parse, one service call, return)",
      "flags the direct Drizzle usage in the route (db.select on t.repos and db.update on t.pullRequests), and the fix moves those queries into repository methods",
      "reports no finding of severity MEDIUM or higher against repository.ts (the clean file); low-severity style notes are tolerated",
    ],
    threshold: 0.7,
  },
  {
    name: "core review keeps reviewer-core pure: no fs, no direct vendor calls, no server back-edge",
    kind: "quality",
    prompt: `I added a weekly digest generator to reviewer-core (reviewer-core/src/digest/run-digest.ts) — DevDigest's review engine package — that summarizes recent review runs with an LLM. Review it for architectural fit before I export it from the package index.

${REVIEW_TASK}

${file("reviewer-core/src/digest/run-digest.ts", "run-digest.ts")}`,
    practices: [
      "flags the node:fs / node:os usage (reading ~/.devdigest/run-history.json) inside reviewer-core, and the fix makes the run history an INPUT to the function — the caller (e.g. the server) does the I/O",
      "flags the direct fetch to openrouter.ai plus the process.env.OPENROUTER_API_KEY read, and the fix is to use the injected LLM provider interface instead of calling the vendor API from core logic",
      "flags the import of ExternalServiceError from ../../../server/src/platform/errors.js as a forbidden core-to-server back-edge (the allowed direction is server → reviewer-core → shared), and the fix uses a core-local or shared error instead",
      "does NOT flag the @devdigest/shared import (an allowed inward dependency) and does NOT claim the pure helper formatDigestInput must move out of reviewer-core",
      "the filesystem-read, direct-vendor-call, and server-back-edge findings are all given the top severity tier of the scale used (e.g. CRITICAL)",
      "explains the purity invariant in substance: reviewer-core's only side effect is the injected LLM provider, and data arrives as inputs",
    ],
    threshold: 0.7,
  },
  {
    name: "placement answer routes each piece to its layer and recommends mechanical enforcement",
    kind: "quality",
    prompt: `Two additions are planned for DevDigest's backend (Fastify + Drizzle + Zod server; separate pure reviewer-core review engine; shared Zod contracts in @devdigest/shared):

1. Posting a summary comment to the pull request on GitHub after a review run finishes.
2. Computing a deterministic "risk score" for a diff (pure heuristics over the changed files — no I/O), shown in the studio and included in the review output.

Answer directly in your reply: where exactly should each piece of code live, and what should each layer depend on? We've also had layering slip through review in past PRs — recommend how to keep these boundaries from silently eroding as the team grows.`,
    grounding: ["dependency-cruiser"],
    practices: [
      "the GitHub comment call is placed behind an adapter interface (a GitHub client port) with the concrete implementation in the adapters layer — not called via octokit/fetch directly from a service or route",
      "the concrete GitHub adapter is wired/instantiated in the composition root (the DI container), and the service depends on the interface it receives, which is what lets tests inject a fake",
      "the pure risk-score computation is placed in reviewer-core with the diff/changed files passed IN as input, keeping the core free of I/O",
      "any new HTTP surface or response shape is validated with a Zod contract at the route edge (shared contracts), not re-validated deeper in",
      "recommends enforcing the boundaries mechanically in CI with dependency-cruiser forbidden rules (e.g. banning reviewer-core → server imports and drizzle-orm imports outside repositories), not just review-time discipline",
      "the answer is organized as a per-layer placement (route / service / port-interface / adapter / container / core), naming a concrete home for each piece rather than giving generic advice",
    ],
    threshold: 0.7,
  },
];
