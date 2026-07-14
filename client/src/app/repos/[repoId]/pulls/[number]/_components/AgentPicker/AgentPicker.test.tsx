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
const { push, mutateAsync } = vi.hoisted(() => ({
  push: vi.fn(),
  mutateAsync: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useParams: () => ({ repoId: "r1" }),
}));

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({
    data: [
      { id: "a1", name: "Security", model: "gpt-4.1", provider: "openai", enabled: true },
      { id: "a2", name: "Performance", model: "gpt-4.1", provider: "openai", enabled: true },
    ],
  }),
}));

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
});

afterEach(() => {
  cleanup();
  push.mockClear();
  mutateAsync.mockClear();
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
    await waitFor(() => expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent"));
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
    await waitFor(() => expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent"));
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
