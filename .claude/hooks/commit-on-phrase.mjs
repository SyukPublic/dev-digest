// UserPromptSubmit hook — commit-on-phrase. When the user's prompt is a terse "commit" command
// (UA "коміть"/"зроби коміт", EN "commit"/"make a commit"), inject an instruction so Claude
// ALWAYS makes a Conventional Commits commit. The hook does NOT run git itself — a deterministic
// script can't author a meaningful conventional message from the diff; it guarantees the
// instruction is present (even after context compaction), and Claude authors the message.
//
// Detection is deterministic; only the message authoring is model-driven. A brevity guard
// (MAX_SIGNAL_LEN) keeps it from firing when "commit"/"коміт" is merely mentioned inside a longer
// sentence ("we'll commit later", "не комить поки що") — a real commit command is short.
//
// Pure Node (no shell/jq) so it behaves identically on Windows and Ubuntu. Wired via exec form in
// .claude/settings.local.json (personal scope). Never blocks the prompt — it only adds context.
import process from "node:process";

// Cyrillic roots match as substrings (JS \b is ASCII-only); English uses word boundaries so
// "commit" fires but "commitment"/"committee" do not.
const PHRASE = /\bcommit\b|коміт|комить/i;
// A genuine commit command is terse. Above this length, treat a match as incidental mention.
const MAX_SIGNAL_LEN = 80;

const INSTRUCTION = [
  "The user asked to commit. Make a git commit NOW with a Conventional Commits message — do not",
  "ask for confirmation (the request IS the authorization). Steps:",
  "1. Inspect what will be committed: `git status` + `git diff --cached` (and `git diff` for",
  "   unstaged work). If nothing is staged, stage the user's current changes; if there is nothing",
  "   to commit at all, say so and stop.",
  "2. Compose the message as `type(scope): subject`:",
  "   - type ∈ feat|fix|docs|refactor|test|chore|build|ci|perf|style",
  "   - scope = the package/area touched (server, client, reviewer-core, e2e, skills, insights, …),",
  "     matching the style already in `git log` (e.g. `docs(skills):`, `feat(insights):`).",
  "   - subject: imperative, ≤72 chars, lowercase, no trailing period. Add a body only if it adds",
  "     real information; end with the `Co-Authored-By: Claude...` trailer per the harness git rule.",
  "3. Commit is LOCAL only — do NOT push or open a PR here, and this does NOT run pr-self-review",
  "   (the publish gate stays on push/PR). If the user said \"commit and push\", commit first; the",
  "   push will then hit the pre-publish self-review gate on its own.",
].join("\n");

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let input = {};
  try { input = JSON.parse(raw || "{}"); } catch { process.exit(0); } // unparseable → do nothing

  const prompt = String(input?.prompt ?? "").trim();
  if (!(prompt.length > 0 && prompt.length <= MAX_SIGNAL_LEN && PHRASE.test(prompt))) {
    process.exit(0); // not a (short) commit command → let the prompt pass through untouched
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: INSTRUCTION,
    },
  }));
  process.exit(0);
});
