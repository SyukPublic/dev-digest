import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { OnboardingSection } from "@devdigest/shared";
import { FirstTasksSection, ReadingPathSection } from "./sections";

/**
 * sections.tsx — per-section renderer tests for behavior not already covered
 * by OnboardingTourView.test.tsx's happy-path fixture (which only ever
 * supplies 2 links per section, so the first_tasks cap was never exercised).
 *
 * Unit under test: `FirstTasksSection` (AC-17 "up to ~4 links").
 * Input: a `first_tasks` section with 6 links.
 * Expected output: only the first 4 render; the 5th/6th are dropped.
 */

function firstTasksSection(linkCount: number): OnboardingSection {
  return {
    kind: "first_tasks",
    title: "First tasks",
    body: "Try these:",
    diagram: null,
    links: Array.from({ length: linkCount }, (_, i) => ({
      label: `Task ${i + 1}`,
      path: `src/tasks/${i + 1}.ts`,
    })),
  };
}

afterEach(cleanup);

describe("FirstTasksSection — link cap (AC-17)", () => {
  it("renders only the first 4 of 6 provided links", () => {
    render(<FirstTasksSection section={firstTasksSection(6)} repoFullName="acme/payments-api" gitRef="main" />);

    for (let i = 1; i <= 4; i++) {
      expect(screen.getByText(`Task ${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByText("Task 5")).not.toBeInTheDocument();
    expect(screen.queryByText("Task 6")).not.toBeInTheDocument();
  });

  it("renders all links when there are 4 or fewer (no over-truncation)", () => {
    render(<FirstTasksSection section={firstTasksSection(2)} repoFullName="acme/payments-api" gitRef="main" />);
    expect(screen.getByText("Task 1")).toBeInTheDocument();
    expect(screen.getByText("Task 2")).toBeInTheDocument();
  });
});

/**
 * ReadingPathSection (R1 + R1b) — ONE list driven by `links[]`; each entry
 * shows a Markdown-rendered description row above a mono file-path row + Open
 * link. R1b sources the description from the `body` numbered list when its item
 * count matches `links.length` (rendered as Markdown-as-data, mapped by index,
 * AC-19); otherwise it composes a sanitized "N. `path` — label" / "N. `path`"
 * fallback (AC-20), degrading on malformed/empty/mismatch body (AC-21) and
 * missing/junk label — never doubled numbering, never a blank row, never a
 * crash. All descriptions render as Markdown-as-data (no
 * dangerouslySetInnerHTML, AC-22/AC-16). (AC-1, AC-2, AC-3, AC-5, AC-17.)
 *
 * The description row and the mono path row can BOTH surface a file path (the
 * fallback wraps `path` in an inline-code badge; a body item may mention it),
 * so path-text assertions use `getAllByText` / the mono `<span>`, and single
 * numbering is asserted against `container.textContent`.
 */
function readingPath(
  links: { label: string; path: string }[],
  body = "",
): OnboardingSection {
  return { kind: "reading_path", title: "Reading path", body, diagram: null, links };
}

/** The mono file-path row renders the path inside `<span class="mono">`; the
 *  description badge renders it inside `<code class="mono">`. Grab the row span. */
function monoPathText(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("span.mono")).map((el) => el.textContent ?? "");
}

describe("ReadingPathSection — single merged list (AC-1, AC-2, AC-5)", () => {
  it("renders exactly ONE list with a description row above each path + Open row", () => {
    const section = readingPath([
      { label: "Entry point — boots the server", path: "src/server.ts" },
      { label: "Route wiring", path: "src/routes.ts" },
    ]);
    const { container } = render(
      <ReadingPathSection
        section={section}
        repoFullName="acme/payments-api"
        gitRef="main"
        openLabel="Open"
        copyLabel="Copy"
      />,
    );

    // ONE <ol>, one <li> per link (facade order) — no second duplicate list.
    expect(container.querySelectorAll("ol")).toHaveLength(1);
    expect(container.querySelectorAll("li")).toHaveLength(2);

    // Description text present (fallback composition uses the label verbatim).
    const text = container.textContent ?? "";
    expect(text).toContain("Entry point — boots the server");
    // Facade order preserved (server before routes) via the mono path rows.
    const paths = monoPathText(container);
    expect(paths).toEqual(["src/server.ts", "src/routes.ts"]);

    // Open deep-link preserved (AC-5): github blob href at the pinned ref.
    const open = screen.getAllByText("Open")[0]!.closest("a");
    expect(open).toHaveAttribute("href", expect.stringContaining("src/server.ts"));
  });

  it("uses the body numbered list as the per-entry description when its count matches links (AC-19)", () => {
    // Old stored tour: full body list carries the REAL descriptions; label junk.
    const section = readingPath(
      [
        { label: "1. _shared.ts", path: "server/src/db/schema/_shared.ts" },
        { label: "2. index.ts", path: "server/src/index.ts" },
      ],
      [
        "1. `server/src/db/schema/_shared.ts` — Foundation: shared DB utilities. Start here.",
        "2. `server/src/index.ts` — Boots the **Fastify** server.",
      ].join("\n"),
    );
    const { container } = render(
      <ReadingPathSection section={section} repoFullName="a/b" gitRef="main" openLabel="Open" copyLabel="Copy" />,
    );

    // The real body descriptions appear (not the junk labels).
    const text = container.textContent ?? "";
    expect(text).toContain("Foundation: shared DB utilities. Start here.");
    expect(text).toContain("Boots the");
    // Inline markdown rendered as DATA: bold **Fastify** → a <strong>, path → <code>.
    expect(container.querySelector("strong")?.textContent).toBe("Fastify");
    expect(container.querySelector(".dd-md")).not.toBeNull();
    // No dangerouslySetInnerHTML anywhere in the tree.
    expect(container.innerHTML).not.toContain("<script");
  });

  /**
   * Unit under test: `ReadingPathSection`, COMPOSED-fallback path (no usable
   * body list → `composeReadingPathDescription` + `sanitizeReadingPathLabel`).
   * Input: two links — one whose label carries model-authored inline markdown
   * (bold + inline code), one whose label is an HTML/script-like string typical
   * of untrusted model output.
   * Stubs: none (pure render; `ReadingPathSection` makes no network/LLM calls).
   * Expected output: the FIRST entry's inline markdown renders as real DOM
   * elements (`<strong>`, a second `<code>` beyond the path badge) — proving the
   * fallback composition (not just the AC-19 body-list path) is Markdown-as-data;
   * the SECOND entry's raw "<script>...” text is rendered as literal on-page TEXT
   * (react-markdown escapes raw HTML by default — no `<script>` tag is parsed
   * into the DOM, and no `dangerouslySetInnerHTML` is used anywhere), so the
   * string never executes (AC-22, AC-16).
   */
  it("renders the COMPOSED fallback description as Markdown-as-data; model-authored HTML-like text never becomes a live tag (AC-22)", () => {
    const section = readingPath(
      [
        { label: "Boots the **Fastify** server via `app.listen()`", path: "src/server.ts" },
        { label: "<script>alert(1)</script> should stay text", path: "src/evil.ts" },
      ],
      "", // no usable body list → composed fallback for both entries
    );
    const { container } = render(
      <ReadingPathSection section={section} repoFullName="a/b" gitRef="main" openLabel="Open" copyLabel="Copy" />,
    );

    // Inline formatting in the fallback-composed label is rendered as DATA:
    // "**Fastify**" → a real <strong>, "`app.listen()`" → a real <code>.
    expect(container.querySelector("strong")?.textContent).toBe("Fastify");
    const codeTexts = Array.from(container.querySelectorAll("code")).map((el) => el.textContent);
    expect(codeTexts).toContain("app.listen()");

    // The script-like label is visible as literal text, NEVER a live <script>
    // element and never injected via dangerouslySetInnerHTML.
    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).not.toContain("<script>alert(1)</script>");
    expect(container.textContent ?? "").toContain("alert(1)");
  });

  it("emits a SINGLE correct number per row (no doubled '1. 1.') for old-shape tours (AC-19, AC-20)", () => {
    const section = readingPath(
      [{ label: "1. _shared.ts", path: "server/src/_shared.ts" }],
      "1. `server/src/_shared.ts` — Foundation: shared utilities.",
    );
    const { container } = render(
      <ReadingPathSection section={section} repoFullName="a/b" gitRef="main" openLabel="Open" copyLabel="Copy" />,
    );
    const text = container.textContent ?? "";
    // Body-list matched → the parsed item (its own "1." stripped) is re-numbered
    // once by index: "1. …", never the doubled "1. 1.".
    expect(text).not.toContain("1. 1.");
    expect(text).toContain("Foundation: shared utilities.");
  });

  it("falls back to a sanitized 'N. path — label' when there is no usable body list (AC-20)", () => {
    // Old junk label with a duplicate "N." prefix; empty body → fallback path.
    const section = readingPath([{ label: "1. Boots the server", path: "src/server.ts" }], "");
    const { container } = render(
      <ReadingPathSection section={section} repoFullName="a/b" gitRef="main" openLabel="Open" copyLabel="Copy" />,
    );
    const text = container.textContent ?? "";
    // Sanitized: duplicate "N." stripped, re-numbered once → "1. …Boots the server".
    expect(text).toContain("Boots the server");
    expect(text).not.toContain("1. 1.");
    // Path present in the mono row exactly once.
    expect(monoPathText(container)).toEqual(["src/server.ts"]);
  });

  it("count mismatch between body list and links → ignores the body, uses the fallback (AC-21)", () => {
    // 3 body items but 2 links: the body list is NOT used (mis-mapping risk).
    const section = readingPath(
      [
        { label: "Entry point", path: "src/server.ts" },
        { label: "Routes", path: "src/routes.ts" },
      ],
      "1. one\n2. two\n3. three",
    );
    const { container } = render(
      <ReadingPathSection section={section} repoFullName="a/b" gitRef="main" openLabel="Open" copyLabel="Copy" />,
    );
    const text = container.textContent ?? "";
    // Fallback descriptions (from labels), not the mismatched body items.
    expect(text).toContain("Entry point");
    expect(text).toContain("Routes");
    expect(text).not.toContain("three");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("malformed / prose-only body → degrades to the fallback, no crash (AC-21)", () => {
    const section = readingPath(
      [{ label: "Entry point", path: "src/server.ts" }],
      "Just some prose with no numbered list at all.",
    );
    const { container } = render(
      <ReadingPathSection section={section} repoFullName="a/b" gitRef="main" openLabel="Open" copyLabel="Copy" />,
    );
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(container.textContent ?? "").toContain("Entry point");
  });

  it("renders 'N. path' alone (no dash, no junk) when the label is missing/empty/filename (AC-20)", () => {
    const section = readingPath([
      { label: "", path: "src/no-desc.ts" },
      { label: "blank.ts", path: "src/blank.ts" }, // label == filename → path alone
    ]);
    const { container } = render(
      <ReadingPathSection section={section} repoFullName="a/b" gitRef="main" openLabel="Open" copyLabel="Copy" />,
    );

    expect(container.querySelectorAll("li")).toHaveLength(2);
    const text = container.textContent ?? "";
    // No em-dash separator when there is no usable description.
    expect(text).not.toContain("—");
    // Numbers still emitted (path-alone), paths present in the mono rows.
    expect(text).toContain("1.");
    expect(text).toContain("2.");
    expect(monoPathText(container)).toEqual(["src/no-desc.ts", "src/blank.ts"]);
  });

  it("renders nothing extra when links is empty (no crash, no rows)", () => {
    const { container } = render(
      <ReadingPathSection section={readingPath([])} repoFullName="a/b" gitRef="main" openLabel="Open" copyLabel="Copy" />,
    );
    expect(container.querySelectorAll("ol")).toHaveLength(1);
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });

  it("renders the row without a resolvable href when repoFullName/ref are unknown", () => {
    const { container } = render(
      <ReadingPathSection
        section={readingPath([{ label: "Entry point", path: "src/server.ts" }])}
        repoFullName={null}
        gitRef={null}
        openLabel="Open"
        copyLabel="Copy"
      />,
    );

    expect(monoPathText(container)).toEqual(["src/server.ts"]);
    const open = screen.getByText("Open");
    expect(open.closest("a")).toBeNull();
  });
});
