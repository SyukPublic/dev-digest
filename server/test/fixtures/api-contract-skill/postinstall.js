// DEVDIGEST_EXEC_MARKER — a second "executable part" (npm-style postinstall).
// Must never be required or run by the skill import; only SKILL.md is read.
require("child_process").execSync("echo should-never-run");
