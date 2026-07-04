import { describe, it, expect } from "vitest";
import enContext from "../../messages/en/context.json";
import ukContext from "../../messages/uk/context.json";
import enRuns from "../../messages/en/runs.json";
import ukRuns from "../../messages/uk/runs.json";
import enAgents from "../../messages/en/agents.json";
import ukAgents from "../../messages/uk/agents.json";
import enSkills from "../../messages/en/skills.json";
import ukSkills from "../../messages/uk/skills.json";

/**
 * AC-18 (T29) — key-parity check for the Project Context Folder feature's
 * NEW user-facing strings between `en` (loaded at runtime) and `uk`
 * (forward-looking mirror per the plan's Open questions / assumptions).
 *
 * Unit under test: the checked-in JSON message files themselves (no
 * component, no next-intl runtime) — a cheap, static parity gate.
 * Input: the `en`/`uk` pair for `context.json` (this feature's whole
 * namespace) plus the three new keys the feature added to pre-existing
 * namespaces (`runs.trace.prompt.perSpec`, `agents.editor.tabs.context`,
 * `skills.editor.tabs.context`).
 * Expected output: every leaf key present on one side is present (with a
 * non-empty string) on the other side too — full bidirectional parity for
 * `context.json`, and presence + non-empty for the three cross-namespace keys.
 *
 * Deliberately scoped: `runs.json`/`agents.json`/`skills.json` are NOT
 * fully mirrored into `uk` (pre-existing debt, out of this plan's scope) —
 * this test only pins the keys THIS feature introduced, not the whole
 * namespace, so it stays green regardless of that separate backlog.
 */

type JsonObject = { [key: string]: unknown };

function flatten(obj: JsonObject, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of flatten(value as JsonObject, path)) out.set(k, v);
    } else {
      out.set(path, value);
    }
  }
  return out;
}

function getPath(obj: JsonObject, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, seg) => {
    if (acc && typeof acc === "object") return (acc as JsonObject)[seg];
    return undefined;
  }, obj);
}

describe("Project Context i18n key parity — en vs uk (AC-18)", () => {
  it("context.json: every en key has a non-empty uk counterpart, and vice versa", () => {
    const enKeys = flatten(enContext as JsonObject);
    const ukKeys = flatten(ukContext as JsonObject);

    const missingInUk = [...enKeys.keys()].filter((k) => !ukKeys.has(k));
    const missingInEn = [...ukKeys.keys()].filter((k) => !enKeys.has(k));
    expect(missingInUk).toEqual([]);
    expect(missingInEn).toEqual([]);

    for (const [key, value] of enKeys) {
      if (typeof value === "string") {
        expect(typeof ukKeys.get(key)).toBe("string");
        expect((ukKeys.get(key) as string).length).toBeGreaterThan(0);
      }
    }
  });

  it.each([
    ["runs.json", enRuns, ukRuns, "trace.prompt.perSpec"],
    ["agents.json", enAgents, ukAgents, "editor.tabs.context"],
    ["skills.json", enSkills, ukSkills, "editor.tabs.context"],
  ] as const)(
    "%s: the new project-context key %s exists as a non-empty string in both en and uk",
    (_file, en, uk, path) => {
      const enValue = getPath(en as JsonObject, path);
      const ukValue = getPath(uk as JsonObject, path);
      expect(typeof enValue).toBe("string");
      expect((enValue as string).length).toBeGreaterThan(0);
      expect(typeof ukValue).toBe("string");
      expect((ukValue as string).length).toBeGreaterThan(0);
    },
  );
});
