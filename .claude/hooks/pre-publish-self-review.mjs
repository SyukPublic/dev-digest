// PreToolUse hook — pr-self-review publish gate. Deterministic backstop that stops an
// unreviewed branch from being PUBLISHED. Fires ONLY on a Bash command that pushes or opens/
// merges a PR (`git push`, `gh pr create`, `gh pr merge`). It does NOT run the review itself
// (a hook can't drive the LLM) — it blocks the publish and asks Claude to run the
// `pr-self-review` skill first. The skill is the source of truth (routing, severity, gate);
// after a clean pass it calls this same script with `--record-pass` to drop a marker, so the
// retried publish (and any later `gh pr create`/`gh pr merge` on the SAME branch content)
// sails through as a no-op.
//
// Dedup is content-addressed: the marker is keyed by `merge-base(main,HEAD)..HEAD`. If nothing
// changed between the push and the PR create/merge, the fingerprint matches and the gate stays
// open — exactly "don't re-trigger if there were no changes between them". Any new/amended
// commit moves HEAD, invalidates the marker, and forces a fresh review.
//
// Pure Node + git (no shell, no jq) so it runs identically on Windows (Desktop App, PowerShell,
// VS Code, JetBrains) and Ubuntu. Wired via exec form in .claude/settings.json. Fails OPEN on
// any internal/git error (a backstop must never brick the user's git over an introspection
// glitch) — the skill, not the hook, is the real gate.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

// True only when a command SEGMENT actually invokes a publish command — `git push`,
// `gh pr create`, `gh pr merge`. The trigger must be the command being RUN, not data: an
// argument, a quoted string, or a heredoc/commit-message body. So we first strip quoted spans
// (single + double quotes — these also swallow `"$(... <<EOF ... EOF)"` message bodies), then
// split on shell separators and test the leading token of each remaining segment. This kills
// every false positive seen so far: `grep "git push"`, `echo '... git push ...'`, and a
// `git commit -m "... git push ..."` whose message merely names the publish commands.
const PUBLISH_SEG = [/^git\s+push\b/, /^gh\s+pr\s+(create|merge)\b/];
function isPublish(cmd) {
  const stripped = String(cmd)
    .replace(/'(?:[^'\\]|\\.)*'/g, " ")  // single-quoted spans → data, not command
    .replace(/"(?:[^"\\]|\\.)*"/g, " "); // double-quoted spans (incl. -m "..." bodies)
  return stripped
    .split(/\n|;|&&|\|\|?/)
    .some((seg) => PUBLISH_SEG.some((re) => re.test(seg.trim())));
}
const BASE_BRANCH = "main";

function git(args) {
  // trim trailing newline; throws on non-zero exit (caller decides whether to fail open).
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

// Content fingerprint of the branch relative to its base. Stable across push → pr create →
// pr merge as long as HEAD doesn't move. Returns null if git can't answer (→ fail open).
function fingerprint() {
  try {
    const root = git(["rev-parse", "--show-toplevel"]);
    const head = git(["rev-parse", "HEAD"]);
    let base = "";
    for (const ref of [BASE_BRANCH, `origin/${BASE_BRANCH}`]) {
      try { base = git(["merge-base", ref, "HEAD"]); break; } catch { /* try next */ }
    }
    const key = `${root}::${base}..${head}`;
    const hash = crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
    return { markerPath: path.join(os.tmpdir(), `dd-prsr-${hash}.ok`), key };
  } catch {
    return null;
  }
}

// --- Mode B: `--record-pass` — the skill calls this after a CRITICAL-free review -------------
if (process.argv.includes("--record-pass")) {
  const fp = fingerprint();
  if (!fp) { process.stderr.write("pr-self-review: cannot fingerprint (not a git repo?)\n"); process.exit(1); }
  fs.writeFileSync(fp.markerPath, `${new Date().toISOString?.() ?? ""}\n${fp.key}\n`);
  process.stdout.write(`pr-self-review: publish marker recorded → ${fp.markerPath}\n`);
  process.exit(0);
}

// --- Mode A: PreToolUse gate (stdin = the hook payload) --------------------------------------
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let input = {};
  try { input = JSON.parse(raw || "{}"); } catch { process.exit(0); } // unparseable → fail open

  const cmd = String(input?.tool_input?.command ?? "");
  if (!isPublish(cmd)) process.exit(0); // not a publish command → allow

  const fp = fingerprint();
  if (!fp) process.exit(0);                       // can't introspect → fail open (skill still gates)
  if (fs.existsSync(fp.markerPath)) process.exit(0); // already reviewed this exact branch content

  // No marker for this content → block the publish and route Claude to the skill.
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "Publish blocked: this branch content has not passed pr-self-review. Run the " +
        "`pr-self-review` skill first — it reviews the `main...HEAD` diff (routing UI files to " +
        "the frontend skills and backend files to the onion/fastify/drizzle skills). If it finds " +
        "any CRITICAL, fix it and do NOT publish. On a clean pass the skill records a marker and " +
        "this command will proceed.",
    },
  }));
  process.exit(0);
});
