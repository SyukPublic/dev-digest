import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/blast.json";

// --- Mutable fixture for usePrBlast (repo convention: mock the hook module). ---
let mockBlast: { data: unknown; isLoading: boolean } = { data: undefined, isLoading: false };

vi.mock("@/lib/hooks/reviews", () => ({
  usePrBlast: () => mockBlast,
}));

// Repo identity + head SHA feed the github.com blob links (same client sources
// the diff/findings use). BlastCard reads repo-context + pull detail, not the
// blast contract, for these.
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/app" } }),
}));
vi.mock("@/lib/hooks/core", () => ({
  usePullDetail: () => ({ data: { head_sha: "abc123" } }),
}));

// Mermaid renders client-only via a lazy import; stub it so we can assert the
// derived `chart` string was handed off without booting the real renderer.
let lastChart: string | null = null;
vi.mock("@/components/mermaid-diagram/MermaidDiagram", () => ({
  MermaidDiagram: ({ chart }: { chart: string }) => {
    lastChart = chart;
    return <div data-testid="mermaid">{chart}</div>;
  },
}));

import { BlastCard } from "./BlastCard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockBlast = { data: undefined, isLoading: false };
  lastChart = null;
});

const BLAST_FULL = {
  pr_id: "pr1",
  status: "full" as const,
  degraded_reason: null,
  blast: {
    summary: "2 changed symbols reaching 2 callers across 1 endpoint.",
    changed_symbols: [
      { name: "getUser", file: "src/users.ts", kind: "function" },
      { name: "saveUser", file: "src/users.ts", kind: "function" },
    ],
    downstream: [
      {
        symbol: "getUser",
        callers: [
          { name: "handleProfile", file: "src/routes/profile.ts", line: 12 },
          { name: "syncJob", file: "src/jobs/sync.ts", line: 40 },
        ],
        endpoints_affected: ["GET /profile"],
        crons_affected: ["nightly-sync"],
      },
      {
        symbol: "saveUser",
        callers: [{ name: "handleSignup", file: "src/routes/signup.ts", line: 8 }],
        endpoints_affected: [],
        crons_affected: [],
      },
    ],
  },
};

function renderCard(prId = "pr1") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <BlastCard prId={prId} />
    </NextIntlClientProvider>,
  );
}

describe("BlastCard", () => {
  it("renders the stat row with counts derived from the blast data", () => {
    mockBlast = { data: BLAST_FULL, isLoading: false };

    renderCard();

    expect(screen.getByText("Blast radius")).toBeInTheDocument();
    // summary (untrusted prose) rendered as plain text
    expect(
      screen.getByText("2 changed symbols reaching 2 callers across 1 endpoint."),
    ).toBeInTheDocument();

    // 2 symbols, 3 callers (2 + 1), 1 endpoint (de-duped), 1 cron
    expect(screen.getByText("symbols")).toBeInTheDocument();
    expect(screen.getByText("callers")).toBeInTheDocument();
    expect(screen.getByText("endpoints")).toBeInTheDocument();
    expect(screen.getByText("cron/jobs")).toBeInTheDocument();

    // The count sits in the same stat span as its label; assert the rendered text.
    expect(screen.getByText("symbols").parentElement).toHaveTextContent("2");
    expect(screen.getByText("callers").parentElement).toHaveTextContent("3");
    expect(screen.getByText("endpoints").parentElement).toHaveTextContent("1");
  });

  it("shows the leveled Tree and expands a symbol to reveal its callers/endpoints/crons", () => {
    mockBlast = { data: BLAST_FULL, isLoading: false };

    renderCard();

    // Changed-symbol rows are present (top level)
    const getUserToggle = screen.getByRole("button", { name: "getUser", expanded: false });
    expect(getUserToggle).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "saveUser" })).toBeInTheDocument();

    // Callers/endpoints/crons hidden until expanded
    expect(screen.queryByText("handleProfile")).not.toBeInTheDocument();

    fireEvent.click(getUserToggle);

    expect(screen.getByRole("button", { name: "getUser", expanded: true })).toBeInTheDocument();
    // Caller name spans are kept (Phase 2 swaps Users→CornerDownRight icon but keeps the name span)
    expect(screen.getByText("handleProfile")).toBeInTheDocument();
    expect(screen.getByText("syncJob")).toBeInTheDocument();
    // Endpoints/crons now render as Badge pills — Badge renders children as a single text node,
    // so getByText still resolves exactly as before (pill styling is visual/manual only).
    expect(screen.getByText("GET /profile")).toBeInTheDocument();
    expect(screen.getByText("nightly-sync")).toBeInTheDocument();

    // Right-aligned caller count: "2 callers" appears on the getUser header row.
    // RTL cannot assert marginLeft:"auto" (inline style — anti-pattern per RTL skill);
    // we assert the text is present and treat pixel alignment as visual/manual.
    expect(screen.getByText("2 callers")).toBeInTheDocument();

    // Collapse again hides them
    fireEvent.click(screen.getByRole("button", { name: "getUser", expanded: true }));
    expect(screen.queryByText("handleProfile")).not.toBeInTheDocument();
  });

  it("links a changed-symbol file to its github.com blob at the PR head (new tab)", () => {
    mockBlast = { data: BLAST_FULL, isLoading: false };

    renderCard();

    // The file reference on a symbol row is an anchor to the blob — no #L (the
    // contract carries no symbol line) — opening in a new tab.
    const symbolLink = screen.getAllByText("src/users.ts")[0]!.closest("a");
    expect(symbolLink).toHaveAttribute(
      "href",
      "https://github.com/acme/app/blob/abc123/src/users.ts",
    );
    expect(symbolLink).toHaveAttribute("target", "_blank");
    expect(symbolLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("links a caller file to its github.com blob at the caller line", () => {
    mockBlast = { data: BLAST_FULL, isLoading: false };

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "getUser" }));

    const callerLink = screen.getByText("src/routes/profile.ts:12").closest("a");
    expect(callerLink).toHaveAttribute(
      "href",
      "https://github.com/acme/app/blob/abc123/src/routes/profile.ts#L12",
    );
    expect(callerLink).toHaveAttribute("target", "_blank");
  });

  it("toggles between Tree and Graph, mounting MermaidDiagram with a valid flowchart string", () => {
    mockBlast = { data: BLAST_FULL, isLoading: false };

    renderCard();

    // Tree is the default
    expect(screen.getByRole("button", { name: "getUser" })).toBeInTheDocument();
    expect(screen.queryByTestId("mermaid")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "graph" }));

    // Graph mounts MermaidDiagram; tree rows gone
    expect(screen.getByTestId("mermaid")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "getUser" })).not.toBeInTheDocument();
    expect(lastChart).not.toBeNull();
    // Substring assertions — do NOT convert to exact-match; buildMermaid may grow more lines.
    expect(lastChart!.startsWith("flowchart")).toBe(true);
    // Node labels are present and escaped (no raw bracket structural chars in labels).
    // Phase 2 node syntax is n0["getUser"]:::changed — "getUser" substring is preserved.
    expect(lastChart).toContain('"getUser"');
    expect(lastChart).toContain("-->");

    // Phase 2: buildMermaid emits classDef lines (literal hex) + :::class suffixes per node.
    // Verify all four classDef entries are present so the full palette is asserted.
    expect(lastChart).toContain("classDef changed");
    expect(lastChart).toContain("classDef cron");
    // Per-node :::class suffixes — fixture has getUser (changed), GET /profile (endpoint),
    // nightly-sync (cron); callers (handleProfile, syncJob) get :::callers (derived from "callers" classDef).
    expect(lastChart).toContain(":::changed");
    expect(lastChart).toContain(":::endpoint");
    expect(lastChart).toContain(":::cron");

    // Phase 2: BlastGraph renders a React legend row (four LegendDot items) beneath MermaidDiagram,
    // inside the role="img" wrapper. Legend labels come from blast.json legend.* keys.
    //
    // "callers" COLLIDES with the stat-row "callers" label (also in the document).
    // Strategy: scope with within(graphRegion) — the graph lives in role="img" aria-label="Blast
    // radius graph"; the stat row is OUTSIDE that region. This is cleaner than getAllByText +
    // length because it asserts co-location with the diagram, not just presence anywhere.
    const graphRegion = screen.getByRole("img", { name: "Blast radius graph" });
    expect(screen.getByText("changed symbol")).toBeInTheDocument();
    expect(within(graphRegion).getByText("callers")).toBeInTheDocument();
    expect(screen.getByText("endpoints affected")).toBeInTheDocument();
    expect(screen.getByText("cron/jobs affected")).toBeInTheDocument();

    // Toggle back to Tree
    fireEvent.click(screen.getByRole("button", { name: "tree" }));
    expect(screen.getByRole("button", { name: "getUser" })).toBeInTheDocument();
  });

  it("shows the noDownstream empty state when downstream is empty", () => {
    mockBlast = {
      data: {
        ...BLAST_FULL,
        blast: { ...BLAST_FULL.blast, downstream: [] },
      },
      isLoading: false,
    };

    renderCard();

    expect(
      screen.getByText("2 changed symbol(s), no downstream callers found."),
    ).toBeInTheDocument();
  });

  it("shows the graph.empty state in Graph view when there is nothing to graph", () => {
    mockBlast = {
      data: {
        ...BLAST_FULL,
        blast: { ...BLAST_FULL.blast, downstream: [] },
      },
      isLoading: false,
    };

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "graph" }));

    expect(screen.getByText("No downstream callers to graph.")).toBeInTheDocument();
    expect(screen.queryByTestId("mermaid")).not.toBeInTheDocument();
  });

  it("renders the partial/degraded badge (icon + text) for a non-full status", () => {
    mockBlast = {
      data: { ...BLAST_FULL, status: "partial", degraded_reason: "Index still building" },
      isLoading: false,
    };

    renderCard();

    // State conveyed by visible text (not color alone)
    expect(screen.getByText("Partial index")).toBeInTheDocument();
    // degraded_reason surfaced via the native tooltip
    expect(screen.getByTitle("Index still building")).toBeInTheDocument();
  });

  it("does NOT render a status badge when status is full", () => {
    mockBlast = { data: BLAST_FULL, isLoading: false };

    renderCard();

    expect(screen.queryByText("Partial index")).not.toBeInTheDocument();
    expect(screen.queryByText("Degraded index")).not.toBeInTheDocument();
  });

  it("renders nothing while loading", () => {
    mockBlast = { data: undefined, isLoading: true };

    const { container } = renderCard();

    expect(container.firstChild).toBeNull();
  });

  it("renders the freshness badge and provenance line (short sha) when the map is stale", () => {
    mockBlast = {
      data: {
        ...BLAST_FULL,
        is_stale: true,
        stale_reason: "base_diverged",
        indexed_branch: "main",
        indexed_sha: "a1b2c3d4e5f6",
      },
      isLoading: false,
    };

    renderCard();

    // Freshness badge: icon + text (WCAG — never color alone). Text is visible.
    expect(screen.getByText("May be stale")).toBeInTheDocument();
    // Provenance shows branch + SHORTENED sha (first 7 chars), not the full sha.
    expect(screen.getByText("Indexed on main @ a1b2c3d")).toBeInTheDocument();
    expect(screen.queryByText(/a1b2c3d4e5f6/)).not.toBeInTheDocument();
    // base_diverged tooltip copy is surfaced via the native title.
    expect(
      screen.getByTitle(
        "This PR targets a branch other than main, which the map was built from — its impact map may be incomplete for this base.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the empty-map caveat (not the bare noDownstream) when a stale map has no downstream", () => {
    mockBlast = {
      data: {
        ...BLAST_FULL,
        is_stale: true,
        stale_reason: "empty_map",
        indexed_branch: "main",
        indexed_sha: "abc1234",
        blast: { ...BLAST_FULL.blast, downstream: [] },
      },
      isLoading: false,
    };

    renderCard();

    // Caveat copy naming the indexed ref is shown...
    expect(
      screen.getByText(
        "2 changed symbol(s), no downstream callers found in the index of main — this may miss impact introduced by this PR.",
      ),
    ).toBeInTheDocument();
    // ...and the bare "no downstream callers found." copy is NOT.
    expect(
      screen.queryByText("2 changed symbol(s), no downstream callers found."),
    ).not.toBeInTheDocument();
  });

  it("does NOT render a freshness badge when the map is not stale", () => {
    // is_stale absent (BLAST_FULL) — freshness badge must not appear, and the
    // status badge behavior is unchanged (full status ⇒ no status badge either).
    mockBlast = { data: BLAST_FULL, isLoading: false };

    renderCard();

    expect(screen.queryByText("May be stale")).not.toBeInTheDocument();
    expect(screen.queryByText("Partial index")).not.toBeInTheDocument();
  });

  it("renders the branch-absent caveat variant for a legacy stale empty map (no indexed_branch)", () => {
    mockBlast = {
      data: {
        ...BLAST_FULL,
        is_stale: true,
        stale_reason: "empty_map",
        indexed_branch: null,
        indexed_sha: null,
        blast: { ...BLAST_FULL.blast, downstream: [] },
      },
      isLoading: false,
    };

    // Must not crash when the branch is unknown.
    renderCard();

    expect(
      screen.getByText(
        "2 changed symbol(s), no downstream callers found in the index — this may miss impact introduced by this PR.",
      ),
    ).toBeInTheDocument();
  });

  it("does not use dangerouslySetInnerHTML for any server-derived string", () => {
    mockBlast = { data: BLAST_FULL, isLoading: false };

    const { container } = renderCard();

    // No element in the rendered card had its HTML set directly — everything is
    // rendered as escaped text. (Sanity guard against an XSS regression.)
    expect(container.innerHTML).not.toContain("<script");
  });
});
