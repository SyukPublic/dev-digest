import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import { ToastProvider } from "@/lib/toast";

/**
 * L07 Phase 7 (T15) — the PR-header multi-agent picker.
 *
 * Boundaries mocked: next/navigation (router + route params), useAgents (DB
 * agents), and the whole multi-agent hooks module (ALL exports overridden so
 * sibling suites that import it don't lose their QueryClient — client/INSIGHTS.md
 * 2026-07-05). Toasts assert via rendered text under a real ToastProvider.
 */
const { push, mutateAsync, useAgents } = vi.hoisted(() => ({
  push: vi.fn(),
  mutateAsync: vi.fn(),
  // Per-test-configurable so a suite can vary the enabled/disabled agent set.
  useAgents: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useParams: () => ({ repoId: "r1" }),
}));

vi.mock("@/lib/hooks/agents", () => ({ useAgents }));

vi.mock("@/lib/hooks/multi-agent", () => ({
  useAgentEstimates: () => ({
    data: [
      { agent_id: "a1", agent_name: "Security", avg_duration_ms: 8200, avg_cost_usd: 0.06, sample_size: 4 },
      { agent_id: "a2", agent_name: "Performance", avg_duration_ms: null, avg_cost_usd: null, sample_size: 0 },
    ],
  }),
  useLaunchMultiAgentRun: () => ({ mutateAsync, isPending: false }),
  useMultiAgentRun: () => ({ data: undefined, isSuccess: false }),
}));

import { AgentPicker } from "./AgentPicker";

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  mutateAsync.mockResolvedValue({ multi_run_id: "m1", pr_id: "pr1", runs: [] });
  // Default: two enabled workspace agents (matching the estimates mock above).
  useAgents.mockReturnValue({
    data: [
      { id: "a1", name: "Security", model: "gpt-4.1", provider: "openai", enabled: true },
      { id: "a2", name: "Performance", model: "gpt-4.1", provider: "openai", enabled: true },
    ],
  });
});

afterEach(() => {
  cleanup();
  push.mockClear();
  mutateAsync.mockClear();
  useAgents.mockReset();
});

function renderPicker(props: Partial<React.ComponentProps<typeof AgentPicker>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages }}>
      <ToastProvider>
        <AgentPicker prId="pr1" {...props} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

/** Open the picker panel by clicking the header trigger. */
function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: /run review/i }));
}

describe("AgentPicker", () => {
  it("lists a checkbox per DB agent with a per-agent estimate and a no-history fallback (AC-4, AC-5)", () => {
    renderPicker();
    openPanel();

    // One checkbox per workspace agent (from useAgents — DB agents only).
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.getByText("Performance")).toBeInTheDocument();

    // a1 has history → time orientation shown; a2 has sample_size 0 → "—" fallback.
    expect(screen.getByText("~8.2s")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("lists only enabled agents — a disabled agent gets no checkbox (AC-8)", () => {
    useAgents.mockReturnValue({
      data: [
        { id: "a1", name: "Security", model: "gpt-4.1", provider: "openai", enabled: true },
        { id: "a2", name: "Performance", model: "gpt-4.1", provider: "openai", enabled: false },
      ],
    });
    renderPicker();
    openPanel();

    // Only the enabled agent is rendered; the disabled one is filtered out entirely.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.queryByText("Performance")).not.toBeInTheDocument();
  });

  it("count/select/clear and the launch payload operate over the enabled subset only (AC-9)", async () => {
    useAgents.mockReturnValue({
      data: [
        { id: "a1", name: "Security", model: "gpt-4.1", provider: "openai", enabled: true },
        { id: "a2", name: "Performance", model: "gpt-4.1", provider: "openai", enabled: false },
        { id: "a3", name: "Style", model: "gpt-4.1", provider: "openai", enabled: true },
      ],
    });
    renderPicker();
    openPanel();

    // Disabled a2 is absent; only the two enabled agents get a checkbox.
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.queryByText("Performance")).not.toBeInTheDocument();

    // Selecting both enabled agents drives the count over the enabled subset.
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    expect(screen.getByRole("button", { name: /run multi-agent review \(2\)/i })).toBeEnabled();

    // Clear resets to zero (the "Clear" control shows only while a selection exists).
    fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));
    expect(screen.getByRole("button", { name: /run multi-agent review \(0\)/i })).toBeDisabled();

    // Re-select and launch: the payload carries only enabled ids (a2 excluded).
    const boxesAgain = screen.getAllByRole("checkbox");
    fireEvent.click(boxesAgain[0]!);
    fireEvent.click(boxesAgain[1]!);
    fireEvent.click(screen.getByRole("button", { name: /run multi-agent review \(2\)/i }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ prId: "pr1", agentIds: ["a1", "a3"] }),
    );
  });

  it("shows the empty state when there are zero enabled agents (AC-10)", () => {
    useAgents.mockReturnValue({
      data: [
        { id: "a1", name: "Security", model: "gpt-4.1", provider: "openai", enabled: false },
        { id: "a2", name: "Performance", model: "gpt-4.1", provider: "openai", enabled: false },
      ],
    });
    renderPicker();
    openPanel();

    // No agent is enabled → the enabled-subset empty state, no checkboxes.
    expect(screen.getByText("No agents yet — create one")).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("disables the run action at zero selection and enables it once an agent is picked (AC-8)", () => {
    renderPicker();
    openPanel();

    expect(screen.getByRole("button", { name: /run multi-agent review \(0\)/i })).toBeDisabled();

    fireEvent.click(screen.getAllByRole("checkbox")[0]!);

    expect(screen.getByRole("button", { name: /run multi-agent review \(1\)/i })).toBeEnabled();
  });

  it("launches with the selected agent ids then routes to the multi-agent page (AC-9)", async () => {
    renderPicker();
    openPanel();

    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    fireEvent.click(screen.getByRole("button", { name: /run multi-agent review \(2\)/i }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ prId: "pr1", agentIds: ["a1", "a2"] }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent?pr=pr1"));
  });

  it("warns on a merged/closed PR yet still permits the run (AC-35)", async () => {
    renderPicker({ warnMerged: true });
    openPanel();

    // The panel warns…
    expect(screen.getByText(/already merged — review is informational/i)).toBeInTheDocument();

    // …but the run is still allowed.
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    fireEvent.click(screen.getByRole("button", { name: /run multi-agent review \(1\)/i }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ prId: "pr1", agentIds: ["a1"] }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent?pr=pr1"));
  });

  it("shows a toast when the launch fails and stays on the page", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("boom"));
    renderPicker();
    openPanel();

    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    fireEvent.click(screen.getByRole("button", { name: /run multi-agent review \(1\)/i }));

    expect(await screen.findByText(/couldn’t launch the multi-agent review/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
