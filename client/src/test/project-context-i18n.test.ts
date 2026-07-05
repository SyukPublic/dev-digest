import { describe, it, expect } from "vitest";
import enContext from "../../messages/en/context.json";
import ukContext from "../../messages/uk/context.json";

/**
 * AC-18 (T29) — key-parity check for the Project Context Folder feature's
 * NEW user-facing strings between `en` (loaded at runtime) and `uk`.
 *
 * Unit under test: the checked-in JSON message files themselves (no
 * component, no next-intl runtime) — a cheap, static parity gate.
 * Input: the `en`/`uk` pair for `context.json` — this feature's whole
 * namespace and the ONLY fully-mirrored `uk` file.
 * Expected output: every leaf key present on one side is present (with a
 * non-empty string) on the other side too — full bidirectional parity for
 * `context.json`.
 *
 * Deliberately scoped: the forward-looking partial `uk` mirrors of
 * `runs.json`/`agents.json`/`skills.json` were DELETED (product decision —
 * not translated), so this test no longer asserts them; only `context.json`
 * is kept in en↔uk parity.
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
});
