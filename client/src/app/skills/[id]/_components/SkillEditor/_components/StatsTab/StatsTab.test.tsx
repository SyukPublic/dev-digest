import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SkillStats, Skill } from "@devdigest/shared";
import skills from "../../../../../../../../messages/en/skills.json";
import common from "../../../../../../../../messages/en/common.json";

let statsState: {
  data: SkillStats | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => void;
};
vi.mock("@/lib/hooks/stats", () => ({
  useSkillStats: () => statsState,
}));

// next/link renders a plain anchor in tests.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { StatsTab } from "./StatsTab";

afterEach(cleanup);

const SKILL = { id: "sk1", name: "pr-quality-rubric", version: 1 } as Skill;

function fullStats(over: Partial<SkillStats> = {}): SkillStats {
  return {
    skill_id: "sk1",
    skill_name: "pr-quality-rubric",
    used_by_agents: 3,
    pull_frequency: 0.71,
    accept_rate: 0.74,
    findings_total: 96,
    agents: [
      { agent_id: "a1", agent_name: "Security Reviewer" },
      { agent_id: "a2", agent_name: "Perf Reviewer" },
    ],
    findings_by_category: [{ category: "security", count: 40 }],
    ...over,
  };
}

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills, common }}>
      <StatsTab skill={SKILL} />
    </NextIntlClientProvider>,
  );
}

describe("Skill StatsTab (AC-30/31/32/33)", () => {
  it("shows a loading skeleton while in flight (AC-5)", () => {
    statsState = { data: undefined, isLoading: true, isError: false, isFetching: true, refetch: vi.fn() };
    const { container } = renderTab();
    expect(container.querySelector(".skeleton")).toBeTruthy();
  });

  it("shows an error state on failure (AC-6)", () => {
    statsState = { data: undefined, isLoading: false, isError: true, isFetching: false, refetch: vi.fn() };
    renderTab();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/could not load skill stats/i)).toBeInTheDocument();
  });

  it("renders the 4 summary cards and pull frequency/accept-rate (AC-30)", () => {
    statsState = { data: fullStats(), isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
    renderTab();
    expect(screen.getByText("3 agents")).toBeInTheDocument(); // used by
    expect(screen.getByText("71%")).toBeInTheDocument(); // pull frequency
    expect(screen.getByText("74%")).toBeInTheDocument(); // accept-rate gauge
    expect(screen.getByText("96")).toBeInTheDocument(); // findings
  });

  it("lists linked agents each with an Open link to the agent editor (AC-32)", () => {
    statsState = { data: fullStats(), isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
    renderTab();
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    const opens = screen.getAllByRole("link", { name: /open/i });
    expect(opens[0]).toHaveAttribute("href", "/agents/a1");
    expect(opens[1]).toHaveAttribute("href", "/agents/a2");
  });

  it("shows an empty state when the skill is linked to no agents (AC-18)", () => {
    statsState = {
      data: fullStats({ used_by_agents: 0, agents: [], pull_frequency: null, findings_total: 0 }),
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };
    renderTab();
    expect(screen.getByText(/no runs in this period/i)).toBeInTheDocument();
  });
});
