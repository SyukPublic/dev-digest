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
 * ReadingPathSection (R1) — ONE list driven by `links[]`; each entry shows a
 * description row (from `link.label`) above a mono file-path row + Open link.
 * The old body-derived numbered list must NOT appear a second time; the render
 * degrades gracefully for the old-shape / mismatch / empty-body / missing-label
 * cases (AC-1, AC-2, AC-3, AC-5, AC-16, AC-17).
 */
function readingPath(
  links: { label: string; path: string }[],
  body = "",
): OnboardingSection {
  return { kind: "reading_path", title: "Reading path", body, diagram: null, links };
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
    const lists = container.querySelectorAll("ol");
    expect(lists).toHaveLength(1);
    expect(container.querySelectorAll("li")).toHaveLength(2);

    // Description (numbered role/rationale) + path both present, description once.
    expect(screen.getByText("Entry point — boots the server")).toBeInTheDocument();
    expect(screen.getByText("src/server.ts")).toBeInTheDocument();
    // Facade order preserved (server before routes).
    const text = container.textContent ?? "";
    expect(text.indexOf("src/server.ts")).toBeLessThan(text.indexOf("src/routes.ts"));

    // Open deep-link preserved (AC-5): github blob href at the pinned ref.
    const open = screen.getAllByText("Open")[0]!.closest("a");
    expect(open).toHaveAttribute("href", expect.stringContaining("src/server.ts"));
  });

  it("does NOT render the body as a second list (old-shape backward-compat, AC-3)", () => {
    // Old stored tour: `body` is the full numbered file list; labels are short.
    const section = readingPath(
      [
        { label: "shared types", path: "src/_shared.ts" },
        { label: "the app", path: "src/app.ts" },
      ],
      "1. src/_shared.ts\n2. src/app.ts",
    );
    const { container } = render(
      <ReadingPathSection section={section} repoFullName="a/b" gitRef="main" openLabel="Open" copyLabel="Copy" />,
    );

    // Still exactly one list, one row per link — the body list is not re-rendered.
    expect(container.querySelectorAll("ol")).toHaveLength(1);
    expect(container.querySelectorAll("li")).toHaveLength(2);
    // Each path appears exactly once (no duplication from the body).
    expect(screen.getAllByText("src/_shared.ts")).toHaveLength(1);
    expect(screen.getAllByText("src/app.ts")).toHaveLength(1);
  });

  it("shows the path row alone when a link.label is missing/empty (no blank description row)", () => {
    const section = readingPath([
      { label: "", path: "src/no-desc.ts" },
      { label: "   ", path: "src/blank.ts" },
    ]);
    const { container } = render(
      <ReadingPathSection section={section} repoFullName="a/b" gitRef="main" openLabel="Open" copyLabel="Copy" />,
    );

    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByText("src/no-desc.ts")).toBeInTheDocument();
    expect(screen.getByText("src/blank.ts")).toBeInTheDocument();
  });

  it("renders nothing extra when links is empty (no crash, no rows)", () => {
    const { container } = render(
      <ReadingPathSection section={readingPath([])} repoFullName="a/b" gitRef="main" openLabel="Open" copyLabel="Copy" />,
    );
    expect(container.querySelectorAll("ol")).toHaveLength(1);
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });

  it("renders the row without a resolvable href when repoFullName/ref are unknown", () => {
    render(
      <ReadingPathSection
        section={readingPath([{ label: "Entry point", path: "src/server.ts" }])}
        repoFullName={null}
        gitRef={null}
        openLabel="Open"
        copyLabel="Copy"
      />,
    );

    expect(screen.getByText("src/server.ts")).toBeInTheDocument();
    const open = screen.getByText("Open");
    expect(open.closest("a")).toBeNull();
  });
});
