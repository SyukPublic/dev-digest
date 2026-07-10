import type { SkillCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// The security skill is OWASP Top 10:2025 for a React + Express + MongoDB/Mongoose + JWT stack
// (NOT DevDigest's Fastify + Drizzle backend). To measure THIS skill honestly the fixtures are
// written in the stack it actually teaches — its concrete advice (String() cast vs Mongo operator
// injection, jwt.verify vs decode, execFile vs exec, DOMPurify) only fires on that stack. Only
// SKILL.md is injected in the content tier (flat examples.md/checklists.md at the skill root are
// NOT loaded — see evals/INSIGHTS.md), so every practice is grounded in what SKILL.md itself
// states. Each review case plants concrete HIGH-confidence vulnerabilities plus at least one
// deliberately-safe pattern the skill's "golden rule" says NOT to flag (framework-mitigated,
// server-controlled, NODE_ENV-gated). Prompts stay neutral so eval:benchmark measures honest lift.

const REVIEW_TASK = `The code below is provided inline — treat it as already read and answer directly in your reply (do not ask for tool access or more files).

For each issue report: the file, the offending line(s) or code, the exploit scenario, a severity (CRITICAL/HIGH/MEDIUM/LOW), a confidence level (HIGH/MEDIUM/LOW), and the concrete fix. For any code you judge safe or already following best practice, say so explicitly and briefly note why, rather than inventing a problem with it.`;

const file = (path: string, fixture: string, lang = "js") =>
  `### ${path}\n\n\`\`\`${lang}\n${fx(fixture)}\n\`\`\``;

export const cases: SkillCase[] = [
  {
    name: "auth review flags fail-open middleware, weak JWT signing, and user enumeration",
    kind: "quality",
    prompt: `Review this admin authentication code for a Node/Express + MongoDB blog (JWT auth) before it ships.

${REVIEW_TASK}

${file("server/src/middleware/admin-auth.js", "admin-auth.js")}`,
    practices: [
      "flags the fail-open auth middleware — jwt.verify() failure is caught but next() is still called unconditionally (no return in the catch), so a request with a missing or invalid token proceeds; the fix returns a 401 in the catch and calls next() only after a successful verify",
      "flags the hardcoded JWT secret string literal 'blog-admin-secret' passed to jwt.sign, and the fix uses a 256-bit random secret read from process.env.JWT_SECRET",
      "flags jwt.sign missing an expiresIn and an explicitly pinned algorithm 'HS256' (so tokens never expire and the 'none'-algorithm class of attack is not prevented)",
      "flags the user-enumeration issue — returning a 404 'No account found for that email' for an unknown email but a 401 'Incorrect password' for a wrong password lets an attacker discover which emails exist; the fix returns one generic 'Invalid credentials' for both",
      "does NOT flag the String(req.body.email) / String(req.body.password) casts, the bcrypt.compare call, or user.toJSON() as vulnerabilities — recognizes them as correct defenses already in place",
    ],
    threshold: 0.7,
  },
  {
    name: "injection review catches NoSQL bypass, command injection, and stored XSS but not escaped JSX",
    kind: "quality",
    prompt: `Review these files from a Node/Express + MongoDB blog with a React 19 frontend. Focus on how untrusted input is handled.

${REVIEW_TASK}

${file("server/src/controllers/content.controller.js", "content-controller.js")}

${file("client/src/components/BlogPost.jsx", "BlogPost.jsx", "jsx")}`,
    practices: [
      "flags the NoSQL operator injection in the login query — req.body.password is placed directly into User.findOne() so an operator object like { \"$gt\": \"\" } matches a user — and the fix stops trusting a raw object in the query: either cast the inputs with String(), or (the stronger defense the skill endorses) look the user up by email only and verify the password with bcrypt.compare so the password never enters the query",
      "flags the command injection in makeThumbnail — req.file.originalname is interpolated into an exec() shell command — and the fix uses execFile() with an argument array",
      "flags the dangerouslySetInnerHTML render of blog.content without sanitization as stored XSS, and the fix sanitizes the HTML (e.g. with DOMPurify, ideally restricting the allowed tags/attributes)",
      "does NOT flag the React auto-escaped {blog.title} / {blog.authorName} expressions or the listByTag query (String() cast + .limit(20)) — recognizes them as framework-mitigated or already-safe",
      "reports each finding with the file, the offending code, an exploit scenario, and a concrete fix rather than a generic warning",
    ],
    threshold: 0.7,
  },
  {
    name: "confidence discipline: reports the real IDOR, spares server-controlled and NODE_ENV-gated code",
    kind: "quality",
    prompt: `Review this Express + MongoDB notes API (all three routes require a valid auth token). Report only issues you are confident are real.

${REVIEW_TASK}

${file("server/src/controllers/notes.controller.js", "notes-controller.js")}`,
    practices: [
      "flags the missing ownership check in deleteNote as an IDOR / broken access control — findByIdAndDelete removes the note identified by req.params.id without checking the owner, so any authenticated user can delete another user's note — and the fix verifies note.author against req.user before deleting",
      "does NOT raise a security false positive on the enrichNote route: no SSRF/injection on the server-controlled `${process.env.ENRICHMENT_URL}` fetch (the URL is not attacker-controlled) and no broken-access-control (enrichNote already verifies note.author) — a benign LOW/optional reliability nit (add a fetch timeout or try/catch) does NOT count as a security false positive",
      "does NOT flag the stack trace in errorHandler as an information leak — it is gated behind process.env.NODE_ENV === 'development' and is never sent to production clients",
      "assigns the reported IDOR finding an explicit severity and confidence level, consistent with the skill's confidence-based review",
    ],
    threshold: 0.7,
  },
  {
    name: "guidance answer covers the OWASP controls for a public authenticated content API",
    kind: "quality",
    prompt: `We're building a public content API on Node/Express + MongoDB (Mongoose) with JWT auth: user login, a comments feature, image uploads, and an AI text-generation endpoint. Before we build it, what are the most important security controls to design in from the start? Answer directly with concrete guidance.`,
    grounding: ["bcrypt"],
    practices: [
      "recommends enforcing access control on the server with deny-by-default auth applied as a barrier (e.g. router.use(auth)) rather than relying on per-route checks or client-side React route guards",
      "recommends rate limiting the login endpoint (roughly 5 attempts per 15 minutes) to resist brute force",
      "recommends hashing passwords with bcrypt at cost/salt rounds >= 10 (or Argon2id), never a fast/plain hash like MD5 or SHA-256",
      "recommends verifying JWTs with jwt.verify() (never jwt.decode()) and signing with an explicit HS256 algorithm and an expiresIn, using a secret from the environment",
      "recommends sanitizing AI-generated (and comment) content before storing it, because generated/user content is a stored-XSS vector",
    ],
    threshold: 0.7,
  },
];
