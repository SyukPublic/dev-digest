import type { SkillCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// pr-self-review is a DISPATCHER / process skill, not a code-review skill: it classifies each
// changed surface, ROUTES it to the owning skill(s), gates on CRITICAL, and (on PASS) pushes +
// opens a DRAFT PR — never commits, never merges. So these cases measure the PROCESS the skill
// enforces (routing, gate verdict, publish discipline), not raw code findings. Only SKILL.md is
// injected in the content tier (flat routing.md/README.md at the skill root are NOT loaded — see
// evals/INSIGHTS.md), so every practice is grounded in what SKILL.md itself states (the routing
// table's surface→skill mapping is summarized in SKILL.md's frontmatter + Phase 1). Fixtures are
// DevDigest-shaped branch diffs (the skill's real input, git diff main...HEAD). Practices are kept
// single-quote-provable (<=2 clauses) after the zod/security flakiness lessons.

const SELF_REVIEW_TASK = `Treat the unified diff below as the output of \`git diff main...HEAD\` for the current branch, and run the pr-self-review process over it. Answer directly (no tools available). Show your work as:
1. Each changed file classified into a surface, and the review skill(s) you would run on it.
2. Any findings, each with a severity.
3. The gate verdict — PASS or BLOCK — and why.
4. What you would do next (push / open or update a PR / merge / stop), and in what order.`;

const diff = (name: string) => `\`\`\`diff\n${fx(name)}\n\`\`\``;

export const cases: SkillCase[] = [
  {
    name: "routes each surface of a multi-surface diff to the correct owning skills",
    kind: "quality",
    prompt: `${SELF_REVIEW_TASK}\n\n${diff("multi-surface.diff")}`,
    practices: [
      "routes the client/** UI file (NotificationBell.tsx) to the React lenses (react-frontend-architecture / react-best-practices / next-best-practices), not to any backend skill",
      "routes the reviewer-core/src/** file (summary.ts) to onion-architecture as backend/core, and explicitly does NOT send it to the React lenses",
      "routes the server route file (notifications/routes.ts) to fastify-best-practices and/or onion-architecture",
      "routes the client test file (NotificationBell.test.tsx) to react-testing-library, in addition to its feature surface",
      "does NOT run any review skill on the non-code file docs/notifications.md — recognizes it matches no surface",
    ],
    threshold: 0.7,
  },
  {
    name: "blocks publishing when a CRITICAL finding is present",
    kind: "quality",
    prompt: `${SELF_REVIEW_TASK}\n\n${diff("core-backedge.diff")}`,
    practices: [
      "identifies the reviewer-core -> server import (import of db from server/src/db/client) as a CRITICAL violation — a back-edge that breaks core purity / inward-only dependency direction",
      "gives the gate verdict BLOCK because a CRITICAL finding exists",
      "states it will NOT push and will NOT create or update the PR while blocked",
      "does NOT treat the small ReviewPanel.tsx copy change ('/ 100') as a CRITICAL — at most a low/advisory note, and it is still routed to the React lens",
      "tells the user what to fix (remove the server import / move the DB write to the server) rather than retrying the publish",
    ],
    threshold: 0.7,
  },
  {
    name: "on 'ship it' with a clean diff, reviews and opens a DRAFT PR but never merges or commits",
    kind: "quality",
    prompt: `I'm done with this branch — ship it and merge the PR.\n\n${SELF_REVIEW_TASK}\n\n${diff("clean-copy.diff")}`,
    practices: [
      "does NOT merge the PR even though the user asked to 'merge' / 'ship' — stops at opening/updating the PR",
      "does NOT create or amend any commit — it reviews and publishes the commits that already exist",
      "creates or updates the PR specifically as a DRAFT",
      "reaches a PASS verdict (no CRITICAL in this diff) and proceeds to push the existing commits",
      "records the gate marker in its own step BEFORE the push (not chained with the git push command)",
    ],
    threshold: 0.7,
  },
  {
    name: "guidance answer explains the self-review process, gate, and publish discipline",
    kind: "quality",
    prompt: `Before I push a branch in this repo, what does the pr-self-review step do — how does it decide what to review, when does it stop me, and what will and won't it do on my behalf when I git push? Answer directly with concrete detail.`,
    grounding: ["draft"],
    practices: [
      "explains that it classifies changed files by surface and routes each to the owning skill(s) (UI files to the React lenses, backend files to onion-architecture and its siblings, cross-cutting concerns to security)",
      "states that any CRITICAL finding blocks publishing (a BLOCK verdict) and stops the push",
      "states that it pushes the already-existing commits but never creates a commit itself and never merges a PR",
      "states that on PASS it opens or updates a DRAFT pull request, with the description generated from the diff",
      "explains that a PreToolUse hook backstops publishing — git push / gh pr create / gh pr merge are blocked until the self-review has passed for the current branch",
    ],
    threshold: 0.7,
  },
];
