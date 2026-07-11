import type { SkillCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// The zod skill is a rule catalog (43 identified rules, SKILL.md + references/*.md all injected
// by skillTask). "quality" cases run content-only (no tools), so each prompt inlines the code
// under review. Fixtures are DevDigest-shaped (shared contract / Fastify route / studio form),
// each planting 3-4 violations of CRITICAL/HIGH rules plus one deliberately-correct pattern as a
// false-positive control. Prompts stay neutral (no rule vocabulary) so eval:benchmark measures
// honest lift over the raw model.

const REVIEW_TASK = `The code below is provided inline — treat it as already read and answer directly in your reply (do not ask for tool access or more files).

For each issue report: the file, the offending line(s) or code, why it is a problem, and the concrete fix you would make (exact API to use). If a part of the code already follows best practice, say so explicitly instead of inventing problems with it.`;

const file = (path: string, fixture: string) => `### ${path}\n\n\`\`\`ts\n${fx(fixture)}\n\`\`\``;

export const cases: SkillCase[] = [
  {
    name: "contract review catches any/enum/email/manual-type issues and spares derived schemas",
    kind: "quality",
    prompt: `Here's a new shared contract for a feedback feature in DevDigest (@devdigest/shared, Zod 3, consumed by both the Fastify server and the React studio). Review the schema definitions before I export them from the barrel.

${REVIEW_TASK}

${file("server/src/vendor/shared/contracts/feedback.ts", "feedback-contract.ts")}`,
    practices: [
      "flags attachment: z.any() as disabling type safety, and the fix is z.unknown() (forcing narrowing) or a properly typed/discriminated schema for the payload",
      "flags category: z.string() for a documented fixed set of values, and the fix is z.enum(['bug', 'suggestion', 'praise']) (or literals/discriminated union) so typos fail validation",
      "flags authorEmail: z.string() missing the email validation, and the fix applies it at schema definition (e.g. .email())",
      "flags the manual Feedback interface as duplication that has already drifted from the schema (attachment is missing from it), and the fix derives the type via z.infer<typeof FeedbackSchema> instead of maintaining it by hand",
      "does NOT flag CreateFeedbackSchema.omit(...) or UpdateFeedbackSchema = CreateFeedbackSchema.partial() — deriving create/update variants from the base schema is the recommended pattern, not duplication",
      "attributes findings to named best-practice rules (e.g. schema-use-unknown-not-any, schema-use-enums, type-use-z-infer) rather than describing problems only ad hoc",
    ],
    threshold: 0.7,
  },
  {
    name: "route review fixes parse-crash, query coercion, and unvalidated JSON at the boundary",
    kind: "quality",
    // "Rank the findings by severity" cues the ranking practice below — a guidance practice only
    // passes when the prompt asks for it (see the pr-self-review lesson in evals/INSIGHTS.md);
    // without the cue the model listed the issues unranked and the practice failed (2026-07-11).
    prompt: `Here's a draft Fastify route file for the feedback feature in DevDigest (Zod 3). Review how it validates incoming data before I register it. Rank the findings by severity (most severe first).

${REVIEW_TASK}

${file("server/src/modules/feedback/routes.ts", "feedback-routes.ts")}`,
    practices: [
      "flags CreateFeedbackSchema.parse(req.body) in the POST handler — on invalid input it throws a ZodError and the request fails as an unhandled 500 — and the fix uses safeParse() with a structured 400 response carrying the validation issues",
      // The fix clause accepts any sound string→boolean strategy, not just z.coerce.boolean():
      // the skill payload teaches z.coerce.number() for query params (compose-shared-schemas.md)
      // but never z.coerce.boolean(), and a model warning that z.coerce.boolean() turns "false"
      // into true (Boolean('false') === true) and preferring a string-based mapping is MORE
      // correct than the old literal demand — which failed exactly that answer (2026-07-11).
      "flags ListQuerySchema using z.number()/z.boolean() for query parameters — query params always arrive as strings, so '42'/'true' would be rejected — and the fix converts them in the schema: z.coerce.number() for the numeric fields, and for the boolean either z.coerce.boolean() or a safer string-based mapping (e.g. z.enum(['true','false']) with a transform), since 'false' coerces to true",
      "flags the JSON.parse(rawMeta) result being used without any Zod validation (meta.userAgent / meta.locale are read off an untyped value), and the fix validates the parsed JSON with a schema before use",
      "does NOT flag the GET handler's safeParse + error.flatten().fieldErrors + 400 pattern — recognizes it as the correct boundary-validation shape",
      "the parse()-crash and query-coercion findings are ranked as the most severe issues in the review (top priority / critical), above any stylistic notes",
    ],
    threshold: 0.7,
  },
  {
    name: "form review returns false from refine, shows all field errors via flatten, keeps superRefine",
    kind: "quality",
    prompt: `This is the client-side validation helper for the DevDigest studio feedback form (Zod 3). Users complain the form only ever shows them one problem at a time and the messages land in odd places. Review the validation code.

${REVIEW_TASK}

${file("client/src/features/feedback/feedback-form.ts", "feedback-form.ts")}`,
    practices: [
      "flags the throw new Error(...) inside the .refine() callbacks, and the fix stops throwing — either returning the boolean condition with a { message } options object, or collecting the failures via superRefine with ctx.addIssue",
      "explains the consequence of throwing in refine: validation stops early so Zod cannot collect the remaining issues, which is exactly why users see only one error at a time",
      "recommends attaching the cross-field email-mismatch error to a path (e.g. path: ['confirmEmail']) so the message lands on the right form field",
      "flags getFormErrors returning only the first issue (error.issues[0]), and the fix uses error.flatten().fieldErrors to get field-keyed errors for the whole form at once",
      "does NOT flag ShareTokenSchema's superRefine with ctx.addIssue — recognizes it as the correct way to report multiple independent issues",
      "every finding comes with a concrete corrected code suggestion or the exact API to use, not only prose",
    ],
    threshold: 0.7,
  },
  {
    name: "guidance answer organizes shared schemas end to end and addresses all three past incidents",
    kind: "quality",
    prompt: `We're building a feedback feature across DevDigest: a React studio form that POSTs to the Fastify API, list endpoints with pagination/filter query parameters, and contracts shared between server and client (both already use Zod 3 via @devdigest/shared).

How should we organize and use the Zod schemas end to end? Three past incidents we must not repeat: (1) a validation exception once took an endpoint down with a 500, (2) a form only ever showed users one error at a time, (3) a hand-written client type silently drifted from the server schema.

Answer directly in your reply with concrete guidance.`,
    grounding: ["safeparse", "flatten"],
    practices: [
      "schemas live in ONE shared module (single source of truth, e.g. @devdigest/shared contracts) imported by both server and client, not duplicated per side",
      "both the schemas AND their inferred types are exported (z.infer), so consumers never hand-write the type — directly addressing the drift incident",
      "recommends safeParse() (not parse()) for user input, because parse() throws on invalid input and crashes the endpoint — directly addressing the 500 incident",
      "validation failures at the API return a structured 400 response carrying the collected issues (e.g. flatten().fieldErrors), not an unhandled exception",
      "query parameters use z.coerce for numeric/boolean fields because they always arrive as strings",
      "form errors are surfaced via error.flatten().fieldErrors so all field errors show at once — directly addressing the one-error-at-a-time incident",
      "validation is placed at the system boundary (API route / form handler), not deep inside business logic",
      "code past the boundary receives the already-parsed, typed data and does not re-validate the same data again",
    ],
    threshold: 0.7,
  },
];
