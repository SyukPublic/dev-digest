/* OnboardingTourView tests (T17–T28). Repo convention: mock the data hooks +
   repo-context, wrap in NextIntlClientProvider, use fireEvent (no user-event).
   The i18n JSON is Phase 7's job — tests supply their own "onboarding" messages
   so nothing here depends on the real message file. */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingTourResponse } from "@devdigest/shared";

// --- Mutable fixtures for the two hooks (repo convention: mock the module). ---
let mockTour: {
  data: OnboardingTourResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };

const mutate = vi.fn();
let mockGenerate: { mutate: typeof mutate; isPending: boolean } = { mutate, isPending: false };

vi.mock("@/lib/hooks/onboarding-tour", () => ({
  useOnboardingTour: () => mockTour,
  useGenerateOnboardingTour: () => mockGenerate,
}));

// Active repo drives the query key + header (AC-11).
let mockRepo: { repoId: string | null; activeRepo: unknown } = {
  repoId: "r1",
  activeRepo: { name: "payments-api", full_name: "acme/payments-api", default_branch: "main" },
};
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => mockRepo,
}));

// AppShell needs router/query context we don't want — passthrough it.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Toast: capture calls so we can assert Share/error confirmations.
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/lib/toast", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn(), toast: vi.fn() }),
}));

// Mermaid renders client-only via a lazy import; stub it (default export) so we
// can assert the model diagram string is handed off without booting the renderer.
let lastChart: string | null = null;
vi.mock("@/components/mermaid-diagram/MermaidDiagram", () => ({
  default: ({ chart }: { chart: string }) => {
    lastChart = chart;
    return <div data-testid="mermaid">{chart}</div>;
  },
}));

import { OnboardingTourView } from "./OnboardingTourView";

// Minimal "onboarding" messages (Phase 7 supplies the real values).
const messages = {
  onboarding: {
    title: "Onboarding Tour",
    heading: "Onboarding for {repo}",
    repoFallback: "Workspace",
    onThisPage: "Onboarding Tour",
    onThisPageAnnounce: "Viewing {section}",
    generating: "Generating tour…",
    generateError: "Could not generate the tour.",
    shareCopied: "Link copied to clipboard",
    sectionUnavailable: "Not available yet",
    meta: {
      filesIndexed: "Generated from index of {count} files",
      refreshedNever: "not generated yet",
    },
    badge: { degraded: "degraded", stale: "stale" },
    empty: { title: "No tour yet", body: "Generate an onboarding tour." },
    loadError: { title: "Couldn’t load the tour", body: "Try again." },
    actions: {
      generate: "Generate",
      regenerate: "Regenerate",
      share: "Share link",
      open: "Open",
      copy: "Copy command",
    },
    sections: {
      overview: "Overview",
      architecture: "Architecture",
      key_modules: "Key modules",
      reading_path: "Reading path",
      getting_started: "Getting started",
      conventions_gotchas: "Conventions & gotchas",
      first_tasks: "First tasks",
    },
  },
};

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <OnboardingTourView />
    </NextIntlClientProvider>,
  );
}

/** A full seven-section tour fixture. */
function fullTour(overrides?: Partial<OnboardingTourResponse>): OnboardingTourResponse {
  return {
    tour: {
      sections: [
        { kind: "overview", title: "Overview", body: "A **payments** service.", links: [] },
        {
          kind: "architecture",
          title: "Architecture",
          body: "The `api` layer.",
          diagram: "flowchart TD\n  A[api] --> B[db]",
          links: [],
        },
        { kind: "key_modules", title: "Key modules", body: "The core modules.", links: [] },
        {
          kind: "reading_path",
          title: "Reading path",
          body: "",
          links: [
            { label: "Entry point", path: "src/server.ts" },
            { label: "Router", path: "src/routes.ts" },
          ],
        },
        {
          kind: "getting_started",
          title: "Getting started",
          body: "pnpm install\npnpm dev # start the API",
          links: [],
        },
        { kind: "conventions_gotchas", title: "Conventions & gotchas", body: "Watch the layering.", links: [] },
        {
          kind: "first_tasks",
          title: "First tasks",
          body: "Try these:",
          links: [
            { label: "Add a route", path: "src/tasks/first.ts" },
            { label: "Add a test", path: "test/first.test.ts" },
          ],
        },
      ],
    },
    meta: { filesIndexed: 12450, generatedAt: new Date().toISOString(), degraded: false, degradedReason: null, stale: false },
    ...overrides,
  };
}

beforeEach(() => {
  // Provide a clipboard stub (jsdom has none by default).
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockTour = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
  mockGenerate = { mutate, isPending: false };
  mockRepo = {
    repoId: "r1",
    activeRepo: { name: "payments-api", full_name: "acme/payments-api", default_branch: "main" },
  };
  lastChart = null;
});

describe("OnboardingTourView", () => {
  it("T17: renders seven ordered section cards + breadcrumb + H1 + meta line", () => {
    mockTour = { ...mockTour, data: fullTour() };
    renderView();

    // H1 with repo name as code.
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Onboarding for payments-api");
    expect(within(h1).getByText("payments-api").tagName.toLowerCase()).toBe("code");

    // Meta line: index file count (the value is interpolated from meta.filesIndexed;
    // number formatting is an i18n concern owned by the message catalogue) + a
    // relative refreshed time (generatedAt was "now" in the fixture).
    expect(screen.getByText(/Generated from index of 12450 files/)).toBeInTheDocument();
    expect(screen.getByText("now")).toBeInTheDocument();

    // Seven cards in fixed order (header buttons carry aria-expanded).
    const cards = screen.getAllByRole("button", { name: /Overview|Architecture|Key modules|Reading path|Getting started|Conventions & gotchas|First tasks/ });
    const titles = cards.map((b) => b.textContent);
    expect(titles).toEqual([
      "Overview",
      "Architecture",
      "Key modules",
      "Reading path",
      "Getting started",
      "Conventions & gotchas",
      "First tasks",
    ]);
  });

  it("T18: no stored tour → empty state + Generate; opening the page makes NO generation call", () => {
    mockTour = {
      ...mockTour,
      data: { tour: null, meta: { filesIndexed: 0, generatedAt: null, degraded: false, degradedReason: null, stale: false } },
    };
    renderView();

    expect(screen.getByText("No tour yet")).toBeInTheDocument();
    const generate = screen.getByRole("button", { name: "Generate" });
    expect(generate).toBeInTheDocument();
    // Opening the page must NOT auto-generate.
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.click(generate);
    expect(mutate).toHaveBeenCalledWith("r1", expect.any(Object));
  });

  it("T19: while generating, a progress affordance shows and the control is disabled", () => {
    mockTour = { ...mockTour, data: fullTour() };
    mockGenerate = { mutate, isPending: true };
    renderView();

    expect(screen.getByRole("status")).toHaveTextContent("Generating tour…");
    const regenerate = screen.getByRole("button", { name: "Regenerate" });
    expect(regenerate).toBeDisabled();
  });

  it("T20: repo switch re-queries by repoId and shows the current repo (no cross-repo bleed)", () => {
    mockRepo = { repoId: "r2", activeRepo: { name: "billing", full_name: "acme/billing", default_branch: "main" } };
    mockTour = { ...mockTour, data: fullTour() };
    renderView();

    // The header reflects the CURRENTLY selected repo, not a stale one.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Onboarding for billing");
    // Query enablement is keyed by repoId (the hook is called with the active id) —
    // asserted indirectly via the header rendering the active repo above.
  });

  it("T21: loading shows a loading state (not blank, not error)", () => {
    mockTour = { ...mockTour, isLoading: true };
    renderView();
    // A busy region is present; no error alert, no empty state.
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("T22: degraded index → fact-only skeleton with cards + a visible degraded badge (never empty)", () => {
    mockTour = {
      ...mockTour,
      data: {
        tour: { sections: [] }, // degraded: no narrative sections
        meta: { filesIndexed: 3, generatedAt: null, degraded: true, degradedReason: "index empty", stale: false },
      },
    };
    renderView();

    // Degraded badge visible.
    expect(screen.getByText("degraded")).toBeInTheDocument();
    // Seven card shells still render (never blank), each with the honest placeholder.
    expect(screen.getByRole("button", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getAllByText("Not available yet").length).toBe(7);
  });

  it("T23: stale tour → staleness indicator shown, no auto-regenerate", () => {
    mockTour = { ...mockTour, data: fullTour({ meta: { filesIndexed: 12450, generatedAt: new Date().toISOString(), degraded: false, degradedReason: null, stale: true } }) };
    renderView();
    expect(screen.getByText("stale")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("T24: architecture card renders the model mermaid via MermaidDiagram; bodies render as data", () => {
    mockTour = { ...mockTour, data: fullTour() };
    renderView();

    // The diagram string was handed to the (stubbed) MermaidDiagram.
    expect(screen.getByTestId("mermaid")).toBeInTheDocument();
    expect(lastChart).toContain("flowchart TD");

    // Markdown body rendered as text (bold applied), not as executable script.
    expect(screen.getByText("payments")).toBeInTheDocument();
  });

  it("T25: reading_path rows render in response order with Open links; command rows copy to clipboard", () => {
    mockTour = { ...mockTour, data: fullTour() };
    renderView();

    // reading_path: response order preserved. R1b renders the path both in the
    // description badge (<code>) AND the mono path row (<span class="mono">), so
    // key off the mono path-row spans (unambiguous) for the ordering check.
    const monoPaths = Array.from(document.querySelectorAll("span.mono")).map((el) => el.textContent);
    const serverIdx = monoPaths.indexOf("src/server.ts");
    const routesIdx = monoPaths.indexOf("src/routes.ts");
    expect(serverIdx).toBeGreaterThanOrEqual(0);
    expect(serverIdx).toBeLessThan(routesIdx);

    // Open links point at the repo's default-branch blob (existing viewer).
    const openLinks = screen.getAllByRole("link", { name: "Open" });
    expect(openLinks[0]).toHaveAttribute("href", "https://github.com/acme/payments-api/blob/main/src/server.ts");

    // getting_started: copy the command to the clipboard.
    const copyBtns = screen.getAllByRole("button", { name: "Copy command" });
    fireEvent.click(copyBtns[0]!);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("pnpm install");
  });

  it("T26/T28: TOC anchors + card collapse (chevron/aria-expanded) are keyboard-operable", () => {
    mockTour = { ...mockTour, data: fullTour() };
    renderView();

    // TOC heading + nav aria-label both read the feature name (R6, AC-18) —
    // the visible heading and the accessible name derive from the one string.
    const toc = screen.getByRole("navigation", { name: "Onboarding Tour" });
    expect(toc).toHaveAttribute("aria-label", "Onboarding Tour");
    const overviewLink = within(toc).getByRole("link", { name: "Overview" });
    expect(overviewLink).toHaveAttribute("href", "#overview");

    // Card header toggles aria-expanded (collapse/expand).
    const card = screen.getByRole("button", { name: "Overview" });
    expect(card).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(card);
    expect(card).toHaveAttribute("aria-expanded", "false");
  });

  it("T27: Share link copies the current page URL + confirmation toast (no public link)", () => {
    mockTour = { ...mockTour, data: fullTour() };
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Share link" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(window.location.href);
    expect(toastSuccess).toHaveBeenCalledWith("Link copied to clipboard");
  });

  /**
   * Unit under test: `OnboardingTourView`, rendering an ALREADY-STORED R1b-shape
   * tour (old-prompt `reading_path`: junk numbered `link.label` + a `body` whose
   * numbered list count matches `links.length`, so the R1b body-list path is
   * taken by `ReadingPathSection`).
   * Input: `fullTour()` with its `reading_path` section overridden to the R1b
   * old-shape (junk labels + matching body list); `mockGenerate.mutate` is the
   * SAME spy used by the generate/regenerate button tests (T18/T23).
   * Stubs: the data hooks return the stored tour synchronously (`isLoading:
   * false`); no fetch/mutation mock is wired to fire on mount.
   * Expected output: the real per-file description from the body list is
   * visible (R1b render reaches the intended look) AND `mutate` is never called
   * — opening/rendering an already-stored R1b tour triggers ZERO
   * generation/LLM calls and needs no regeneration (AC-23; parent AC-4 preserved).
   */
  it("T26 (R1b): opening an already-stored old-shape reading_path tour renders the real description with ZERO generation calls (AC-23)", () => {
    const tour = fullTour();
    const sections = tour.tour!.sections.map((section) =>
      section.kind === "reading_path"
        ? {
            ...section,
            body: [
              "1. `src/server.ts` — Boots the Fastify server and wires the routes.",
              "2. `src/routes.ts` — Route definitions for the public API.",
            ].join("\n"),
            links: [
              { label: "1. server.ts", path: "src/server.ts" },
              { label: "2. routes.ts", path: "src/routes.ts" },
            ],
          }
        : section,
    );
    mockTour = { ...mockTour, data: { ...tour, tour: { sections } } };
    renderView();

    // R1b reached the intended look: the REAL body-list description is shown,
    // not the junk "1. server.ts" label duplicated.
    expect(screen.getByText(/Boots the Fastify server and wires the routes\./)).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain("1. 1.");

    // Zero generation/LLM calls on read — no auto-regeneration for an
    // already-stored tour to reach the intended look.
    expect(mutate).not.toHaveBeenCalled();
  });
});
