// PreToolUse hook — commit test-gate (diff-aware). Blocks a `git commit` when the test suite of
// ANY package touched by the STAGED diff is RED. Complements the pre-publish review gate (which
// fires on push/PR and reviews); this one fires on commit and TESTS.
//
// Per-package run commands come from a machine-local, gitignored map so the committed hook stays
// portable and machine-agnostic:
//   .claude/verify-gate.local.json  =  { "server": "<cmd>", "client": "<cmd>",
//                                         "reviewer-core": "<cmd>", "mcp": "<cmd>" }
// On this machine each command routes through the WSL test-mirror (server vitest can't run on
// Windows — linux-only esbuild). A touched package with no map entry is SKIPPED (logged); no map
// at all → nothing runs (fail-open) — the committed hook is inert until a machine opts in.
//
// FAIL-OPEN on anything that is NOT a genuine test failure (missing map/toolchain/platform/
// timeout): a backstop must never brick commits. BLOCK only on vitest's real `Tests N failed`
// marker. Packages run SEQUENTIALLY (never in parallel — concurrent WSL vitest flakes with
// `onTaskUpdate` timeouts, per CLAUDE.local.md). Pure Node — identical on Windows and Ubuntu.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

// Fire only when a command SEGMENT actually runs `git commit` — not when "git commit" appears
// inside a quoted string / -m message body. Strip quoted spans first, then split on shell
// separators and test the leading token (same technique as pre-publish-self-review.mjs).
// Leading global options are tolerated, including the value-consuming `-c key=val` / `-C path`
// forms, while a bare subcommand (`git config commit.x`, `git grep commit`) is NOT matched.
const COMMIT_SEG = /^git\s+(?:(?:-[cC]\s+\S+|--?\S+)\s+)*commit\b/;
function isCommit(cmd) {
  const stripped = String(cmd)
    .replace(/'(?:[^'\\]|\\.)*'/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, " ");
  return stripped.split(/\n|;|&&|\|\|?/).some((seg) => COMMIT_SEG.test(seg.trim()));
}

// A genuine vitest RED (as opposed to "couldn't even start the runner").
const RED = /(?:Test Files|Tests)\s+\d+\s+failed/i;

// Packages the gate knows about, in a STABLE run order (server first so its shared source is
// mirrored before reviewer-core/mcp reuse it in the same commit).
const PACKAGES = ["server", "client", "reviewer-core", "mcp"];
// Map a repo-relative path to its owning package (top dir), or null for files no package owns
// (docs, `.claude/**`, root config). `server/src/vendor/shared/**` lives under `server/` → server.
function pkgOf(file) {
  const top = String(file).split("/")[0];
  return PACKAGES.includes(top) ? top : null;
}

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let input = {};
  try { input = JSON.parse(raw || "{}"); } catch { process.exit(0); } // unparseable → allow

  const cmd = String(input?.tool_input?.command ?? "");
  if (!isCommit(cmd)) process.exit(0); // not a commit → allow

  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  // Which packages does the staged diff touch? (a commit includes staged content only)
  let staged = "";
  try {
    staged = execSync("git diff --cached --name-only", { cwd: root, encoding: "utf8" });
  } catch {
    process.stderr.write("commit test-gate: cannot read staged diff — allowing (fail-open)\n");
    process.exit(0);
  }
  const touched = new Set(
    staged.split(/\r?\n/).map((f) => f.trim()).filter(Boolean).map(pkgOf).filter(Boolean),
  );
  if (touched.size === 0) process.exit(0); // no package surface staged → allow

  // Machine-local command map (gitignored). Absent → nothing to run → fail-open.
  let map = {};
  try {
    map = JSON.parse(fs.readFileSync(path.join(root, ".claude", "verify-gate.local.json"), "utf8"));
  } catch {
    process.stderr.write("commit test-gate: no .claude/verify-gate.local.json — allowing (fail-open)\n");
    process.exit(0);
  }

  const reds = [];      // packages whose suite is genuinely RED
  const skipped = [];   // touched but no command, or could not be run (infra)
  for (const pkg of PACKAGES) {            // stable order; SEQUENTIAL (never parallel)
    if (!touched.has(pkg)) continue;
    const runCmd = map[pkg];
    if (!runCmd) { skipped.push(`${pkg} (no command in map)`); continue; }
    try {
      execSync(runCmd, { cwd: root, encoding: "utf8", stdio: "pipe", timeout: 280_000 });
    } catch (err) {
      const out = `${err?.stdout ?? ""}\n${err?.stderr ?? ""}`;
      if (RED.test(out)) reds.push(pkg);
      else skipped.push(`${pkg} (could not run — fail-open)`);
    }
  }

  if (skipped.length) process.stderr.write(`commit test-gate: ${skipped.join("; ")}\n`);
  if (reds.length === 0) process.exit(0); // every runnable suite green → allow

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `Commit blocked: test suite RED in ${reds.join(", ")}. Fix the failing test(s) — ` +
        `run that package's suite via the WSL mirror (scripts/test-mirror.sh) — then commit ` +
        `again. This is a deterministic test-gate; it does not run the review (that stays on push/PR).`,
    },
  }));
  process.exit(0);
});
