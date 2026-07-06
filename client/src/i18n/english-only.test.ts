import { describe, it, expect } from "vitest";
import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 13 (T38) — English-only localization verify (AC-17, 2026-07-06 delta).
 *
 * DevDigest ships a SINGLE locale, `en` (AGENTS.md "Conventions", client
 * AGENTS.md "Gotchas"). This is a VERIFICATION pass, not a new behavior: it
 * pins that no `messages/uk/` (or any other `messages/<locale>`) directory
 * exists, and that the Why+Risk Brief feature's UI components carry no
 * hardcoded literal strings outside next-intl `t(...)` calls. Model-authored
 * brief text (what/why/risk title/explanation) is CONTENT rendered from data,
 * not a UI string, and is out of scope for this grep (it's not sourced from
 * next-intl by design — DEFAULT_CONTENT_LANGUAGE governs it instead).
 *
 * Unit under test: the real `client/messages/` directory tree on disk (a
 * project-structure invariant, not an injectable dependency — reading the
 * actual filesystem IS the correct check here, not a unit to stub) + the
 * brief feature's component source text.
 */

const MESSAGES_DIR = join(process.cwd(), "messages");

const BRIEF_COMPONENT_FILES = [
  "src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx",
  "src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx",
  "src/app/repos/[repoId]/pulls/[number]/_components/ReviewFocusSection/ReviewFocusSection.tsx",
];

describe("English-only localization — client/messages/ (T38, AC-17)", () => {
  it("has exactly one locale directory: en", () => {
    const entries = readdirSync(MESSAGES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(entries).toEqual(["en"]);
  });

  it("has NO messages/uk directory (no stray uk mirror)", () => {
    expect(existsSync(join(MESSAGES_DIR, "uk"))).toBe(false);
  });

  it("has NO other messages/<locale> directory beyond en", () => {
    const entries = readdirSync(MESSAGES_DIR, { withFileTypes: true }).filter((e) =>
      e.isDirectory(),
    );
    for (const e of entries) {
      expect(e.name).toBe("en");
    }
  });

  it("messages/en/brief.json exists and is the only brief namespace file", () => {
    const enDir = join(MESSAGES_DIR, "en");
    expect(existsSync(join(enDir, "brief.json"))).toBe(true);
    // No other locale carries a brief.json (would only be possible via a stray
    // non-en directory, already asserted absent above, but double-check depth).
    const briefFiles = readdirSync(MESSAGES_DIR, { withFileTypes: true, recursive: true })
      .filter((e) => !e.isDirectory() && e.name === "brief.json")
      .map((e) => join((e as { parentPath?: string; path?: string }).parentPath ?? (e as { path: string }).path, e.name));
    expect(briefFiles).toHaveLength(1);
    expect(briefFiles[0]).toContain(join("en", "brief.json"));
  });
});

describe("English-only localization — brief components have no hardcoded UI literals (T38, AC-17)", () => {
  for (const relPath of BRIEF_COMPONENT_FILES) {
    it(`${relPath} sources every JSX text child via useTranslations, not a literal`, () => {
      const abs = join(process.cwd(), relPath);
      expect(statSync(abs).isFile()).toBe(true);
      const src = readFileSync(abs, "utf8");

      // Every brief component reads its strings through the "brief" namespace.
      expect(src).toMatch(/useTranslations\(\s*["']brief["']\s*\)/);

      // No bare JSX text child that looks like a user-facing English sentence
      // (a run of letters/spaces/punctuation starting with an uppercase letter,
      // rendered directly between JSX tags, e.g. `>Some Label<`). This excludes
      // `{t(...)}`/`{expr}` interpolations (curly braces) and short symbol-only
      // children (the em-dash separator, aria-hidden glyphs) which are NOT
      // localizable content.
      const bareJsxTextChild = />\s*[A-Z][A-Za-z][^<>{}]{2,}</g;
      const matches = [...src.matchAll(bareJsxTextChild)].map((m) => m[0]);
      expect(matches).toEqual([]);
    });
  }
});
