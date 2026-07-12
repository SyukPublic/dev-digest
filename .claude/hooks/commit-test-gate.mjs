// PreToolUse hook — L06 commit test-gate. Deterministic backstop: block a `git commit`
// when the L06 acceptance suite (`pnpm verify:l06`) is RED. Complements the pre-publish
// review gate (that one fires on push/PR and reviews; this one fires on commit and TESTS).
//
// Command to run is resolved in this order:
//   1) env DEVDIGEST_L06_VERIFY_CMD  — a full shell command (this machine sets it to the
//      WSL-mirror invocation in settings.local.json, because server vitest can't run on
//      Windows here: server/node_modules ships linux-only esbuild — platform trap).
//   2) default (portable): `pnpm run verify:l06` with cwd = server/  (works on a machine
//      whose server deps match its own platform, and in CI).
//
// FAIL-OPEN on anything that is NOT a genuine test failure (missing toolchain, esbuild
// platform error, rsync/install hiccup, timeout): a backstop must never brick commits over
// an infra glitch. We BLOCK only when the output carries vitest's real failure marker
// (`Tests N failed` / `Test Files N failed`). Pure Node — identical on Windows and Ubuntu.
import path from "node:path";
import { execSync } from "node:child_process";

// Fire only when a command SEGMENT actually runs `git commit` — not when "git commit" appears
// inside a quoted string / -m message body. Strip quoted spans first, then split on shell
// separators and test the leading token (same technique as pre-publish-self-review.mjs).
// Leading global options are tolerated, including the value-consuming `-c key=val` / `-C path`
// forms — so `git -c user.name=x commit` still matches — while a bare subcommand (`git config
// commit.x`, `git grep commit`) does NOT (its token isn't an option → the group stops).
const COMMIT_SEG = /^git\s+(?:(?:-[cC]\s+\S+|--?\S+)\s+)*commit\b/;
function isCommit(cmd) {
  const stripped = String(cmd)
    .replace(/'(?:[^'\\]|\\.)*'/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, " ");
  return stripped.split(/\n|;|&&|\|\|?/).some((seg) => COMMIT_SEG.test(seg.trim()));
}

// A genuine vitest RED (as opposed to "couldn't even start the runner").
const RED = /(?:Test Files|Tests)\s+\d+\s+failed/i;

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let input = {};
  try { input = JSON.parse(raw || "{}"); } catch { process.exit(0); } // unparseable → allow

  const cmd = String(input?.tool_input?.command ?? "");
  if (!isCommit(cmd)) process.exit(0); // not a commit → allow

  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const override = process.env.DEVDIGEST_L06_VERIFY_CMD;
  const opts = { cwd: root, encoding: "utf8", stdio: "pipe", timeout: 110_000 };

  try {
    if (override) execSync(override, opts);
    else execSync("pnpm run verify:l06", { ...opts, cwd: path.join(root, "server") });
    process.exit(0); // exit 0 → suite green → allow
  } catch (err) {
    const out = `${err?.stdout ?? ""}\n${err?.stderr ?? ""}`;
    if (!RED.test(out)) {
      // could NOT run the suite (toolchain/platform/timeout) → fail OPEN, don't brick commits
      process.stderr.write("verify:l06 gate: could not run suite — allowing commit (fail-open)\n");
      process.exit(0);
    }
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "Commit blocked: the L06 acceptance suite is RED. Run `pnpm verify:l06` " +
          "(server), fix the failing test(s), then commit again. This is a deterministic " +
          "test-gate — it does not run the review (that stays on push/PR).",
      },
    }));
    process.exit(0);
  }
});
