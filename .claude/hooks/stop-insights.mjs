// Stop hook — L06 preview (prototype). Deterministic backstop for the engineering-insights
// wrap-up sweep. Fires ONLY on a user completion signal (condition 2): the last human prompt
// matches one of DONE_PHRASES, the session made real code edits, and new edits happened since
// the previous sweep. The model's own "I think it's done" judgement (condition 1) stays
// model-driven and is NOT handled here. The skill remains the source of truth (routing,
// anti-banality, read-before-write dedup), so a redundant fire is a cheap no-op.
//
// Pure Node (no shell, no jq) so it runs identically on Windows (Desktop App, PowerShell, VS
// Code, JetBrains) and Ubuntu. Wired via exec form in .claude/settings.json.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// --- Edit this list to tune what counts as "I'm done" ----------------------------------------
// Substring match, case-insensitive. Keep phrases unambiguous — avoid bare "ок"/"все"/"далі",
// which fire on normal mid-work sentences.
const DONE_PHRASES = [
  // wrap-up / move-on signals (gratitude/ack words like "дякую"/"готово"/"done" are deliberately
  // excluded — they show up in normal dialogue far more often than they mean "finished")
  "інше питання", "рухаємось далі", "перейдемо до", "на цьому все",
  "lgtm", "looks good", "ship it",
  // commit/push requests — a strong "work is final" signal (covers "коміть і пуш",
  // "коміть пуш", "коміть/пуш", "роби пуш" via the individual tokens below)
  "коміть", "коміт", "комить", "закоміть", "закоміт", "зроби коміт",
  "пуш", "запуш", "запуши", "пушни", "роби пуш", "зроби пуш",
  "commit and push", "commit & push", "commit/push", "git push", "git commit",
  "do push", "push it", "push to remote", "push the changes", "commit it",
];
//
// A signal is only honoured in a SHORT message — a genuine "done" is terse. This stops the hook
// firing when the phrases are merely quoted/discussed inside a long message.
const MAX_SIGNAL_LEN = 60;
// ---------------------------------------------------------------------------------------------

const DONE = new RegExp(
  DONE_PHRASES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "i",
);

// Text of a genuine human prompt, or null for assistant turns, tool results, and hook/system
// injected messages (isMeta — e.g. our own "Stop hook feedback" reason is recorded as a user msg).
function humanPromptText(o) {
  if (!o || o.type !== "user" || !o.message || o.isMeta === true) return null;
  const c = o.message.content;
  if (typeof c === "string") return c.trim() || null;
  if (Array.isArray(c)) {
    if (c.some((b) => b && b.type === "tool_result")) return null; // tool result, not a prompt
    const t = c
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return t || null;
  }
  return null;
}

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let input = {};
  try { input = JSON.parse(raw || "{}"); } catch { /* malformed → guards below exit safely */ }

  // 1) Loop guard: this stop is our own continuation → let Claude stop.
  if (input.stop_hook_active) process.exit(0);

  // 2) Parse the transcript. Without it we can't detect the signal → fail closed (don't fire).
  let lines;
  try {
    lines = fs.readFileSync(String(input.transcript_path), "utf8").split(/\r?\n/).filter(Boolean);
  } catch { process.exit(0); }

  let realEdits = 0;
  let lastPrompt = "";
  for (const ln of lines) {
    let o;
    try { o = JSON.parse(ln); } catch { continue; }
    const hp = humanPromptText(o);
    if (hp != null) lastPrompt = hp;
    const content = o && o.message && o.message.content;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b && b.type === "tool_use" && /^(Edit|Write|NotebookEdit)$/.test(b.name)) {
          const fp = (b.input && (b.input.file_path || b.input.notebook_path)) || "";
          if (!/INSIGHTS\.md$/i.test(fp)) realEdits++; // ignore the skill's own INSIGHTS writes
        }
      }
    }
  }

  // 3) Gate: real code work happened, and the latest human prompt is a SHORT completion signal
  //    (brevity guards against the phrases being merely quoted inside a longer message).
  if (realEdits === 0) process.exit(0);
  if (!(lastPrompt.length <= MAX_SIGNAL_LEN && DONE.test(lastPrompt))) process.exit(0);

  // 4) ...and there is NEW work since the previous sweep (also de-dups repeated signals).
  const sid = String(input.session_id || "nosession").replace(/[^a-z0-9_-]/gi, "");
  const cursor = path.join(os.tmpdir(), `dd-insights-${sid}.cursor`);
  let lastFired = 0;
  try { lastFired = parseInt(fs.readFileSync(cursor, "utf8"), 10) || 0; } catch { /* none yet */ }
  if (realEdits <= lastFired) process.exit(0);

  // 5) Fire: record the cursor and ask Claude to run the wrap-up sweep before ending.
  fs.writeFileSync(cursor, String(realEdits));
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason:
      "Before ending: run the engineering-insights skill as a wrap-up sweep over this session. " +
      "Identify the module(s) the work touched, read that module's INSIGHTS.md first, and append " +
      "only durable, non-obvious findings (anti-banality gate, append-only, no duplicates). " +
      "If nothing substantial and new emerged, say so briefly and stop — an empty capture is correct.",
  }));
  process.exit(0);
});
