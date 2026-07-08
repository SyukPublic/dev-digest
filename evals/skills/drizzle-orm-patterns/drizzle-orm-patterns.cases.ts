import type { SkillCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// The drizzle-orm-patterns skill is a pattern/best-practice catalog for Drizzle (SKILL.md +
// references/*.md are ALL injected in the content tier — it has a references/ DIRECTORY). "quality"
// cases run content-only (no tools), so each prompt inlines the code under review. Fixtures are
// DevDigest-shaped (Postgres + Drizzle, the project's real stack), each planting concrete
// anti-patterns the skill names (direct FK ref, missing index, hand-written types, N+1, unfiltered
// soft-delete, missing transaction, loop insert) plus deliberately-correct patterns as
// false-positive controls (notably consumeQuota's tx.rollback(), which the skill's own Example 3
// endorses). Prompts stay neutral so eval:benchmark measures honest lift; practices are kept
// single-quote-provable (<=2 clauses) per the zod/security flakiness lessons.

const REVIEW_TASK = `The code below is provided inline — treat it as already read and answer directly in your reply (do not ask for tool access or more files).

For each issue report: the file, the offending code, why it is a problem, and the concrete Drizzle fix (the corrected code or the exact API to use). For any code that already follows Drizzle best practice, say so explicitly and briefly note why, rather than inventing a problem with it.`;

const file = (path: string, fixture: string) => `### ${path}\n\n\`\`\`ts\n${fx(fixture)}\n\`\`\``;

export const cases: SkillCase[] = [
  {
    name: "schema review flags direct FK ref, missing index, and hand-written type; spares correct columns",
    kind: "quality",
    prompt: `Review this Drizzle schema file for a DevDigest server table (PostgreSQL, Drizzle 0.38) before I wire it into the schema barrel.

${REVIEW_TASK}

${file("server/src/db/schema/comments.ts", "schema-comments.ts")}`,
    practices: [
      "flags the foreign key .references(pullRequests.id) being passed a direct column instead of an arrow function, and the fix is .references(() => pullRequests.id)",
      "flags the missing index on the prId foreign-key column (queried/joined per PR), and the fix adds an index() in the table's config callback",
      "flags the hand-written Comment interface as duplicating the table shape that will drift, and the fix derives it via typeof comments.$inferSelect (or InferSelectModel)",
      "does NOT flag the correct column definitions (serial primary key, .notNull(), .default(false), .defaultNow()) as problems",
      "each finding includes the corrected Drizzle code or exact API, not just a generic description",
    ],
    threshold: 0.7,
  },
  {
    name: "query review catches N+1, unbounded select, and unfiltered soft-delete; spares the correct query",
    kind: "quality",
    prompt: `Review the queries in this DevDigest repository class (PostgreSQL + Drizzle). The comments table has a deletedAt soft-delete column.

${REVIEW_TASK}

${file("server/src/modules/reviews/repository.ts", "reviews-repository.ts")}`,
    practices: [
      "flags the N+1 query in listWithFindings — a separate findings query is run per review inside the loop — and the fix fetches them together with a join or the relations query API (db.query...with)",
      "flags searchComments loading every comment with select().from() and filtering in JavaScript, rather than filtering in the database query",
      "flags that commentsForPr does not filter out soft-deleted rows despite the deletedAt column, and the fix adds isNull(t.comments.deletedAt) to the where clause",
      "does NOT flag recentActiveComments — recognizes it as the correct pattern (specific columns, filtered where with isNull, ordered, limited)",
      "each finding includes the corrected Drizzle code or exact API, not just a generic description",
    ],
    threshold: 0.7,
  },
  {
    name: "mutation review flags the missing transaction and loop insert; spares the correct rollback and single write",
    kind: "quality",
    prompt: `Review the write operations in this DevDigest class (PostgreSQL + Drizzle) for correctness and atomicity.

${REVIEW_TASK}

${file("server/src/modules/reviews/review-writer.ts", "review-writer.ts")}`,
    practices: [
      "flags recordResult performing two dependent writes (insert into reviews, then update pullRequests.status) without a transaction, so a partial failure leaves inconsistent state",
      "the fix wraps those writes in db.transaction and routes both through the tx handle (tx.insert / tx.update), not the outer db",
      "flags importComments inserting rows one at a time inside a loop instead of a single batch insert (db.insert(...).values(rows))",
      "does NOT flag archiveReview — it already wraps its two dependent writes in a db.transaction through the tx handle, which is the correct pattern",
      "does NOT flag markSeen — a single update statement is already atomic and needs no transaction",
    ],
    threshold: 0.7,
  },
  {
    name: "guidance answer covers the Drizzle best practices for the DevDigest data layer",
    kind: "quality",
    prompt: `We're growing the DevDigest server's data layer (PostgreSQL + Drizzle 0.38): more tables, repositories, and multi-step writes. What Drizzle practices should we standardize on to keep it type-safe, correct, and fast? Answer directly with concrete guidance.`,
    grounding: ["transaction"],
    practices: [
      "recommends wrapping multi-step writes that must succeed together in a transaction (db.transaction), so a partial failure cannot leave inconsistent state",
      "recommends deriving TypeScript types from the schema with $inferSelect / $inferInsert (or InferSelectModel/InferInsertModel) instead of hand-writing them",
      "recommends adding indexes on foreign keys and frequently-queried/sorted columns",
      "recommends versioned migrations in production (drizzle-kit generate then migrate), reserving drizzle-kit push for local development",
      "recommends defining foreign key references with an arrow function (() => table.column) to avoid circular-dependency issues",
    ],
    threshold: 0.7,
  },
];
