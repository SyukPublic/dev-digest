import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import evalMessages from "../../../messages/en/eval.json";
import EvalDashboardPage from "./page";

const push = vi.fn();
let params = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => params,
}));
vi.mock("@/lib/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
// Mock the four view slices to markers so this test only asserts the tab/param
// switch (each view has its own dedicated test).
vi.mock("./_components/AllAgentsView", () => ({ AllAgentsView: () => <div>ALL_AGENTS</div> }));
vi.mock("./_components/AgentDashboardView", () => ({ AgentDashboardView: ({ agentId }: { agentId: string }) => <div>AGENT_DASH:{agentId}</div> }));
vi.mock("./_components/AllSkillsView", () => ({ AllSkillsView: () => <div>ALL_SKILLS</div> }));
vi.mock("./_components/SkillDashboardView", () => ({ SkillDashboardView: ({ skillId }: { skillId: string }) => <div>SKILL_DASH:{skillId}</div> }));

afterEach(() => {
  cleanup();
  push.mockClear();
});

function renderPage(search: string) {
  params = new URLSearchParams(search);
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <EvalDashboardPage />
    </NextIntlClientProvider>,
  );
}

describe("EvalDashboardPage — Agents|Skills tab split (AC-23)", () => {
  it("defaults to the Agents tab and renders the all-agents overview verbatim", () => {
    renderPage("");
    // both tabs are present
    expect(screen.getByRole("tab", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Skills" })).toBeInTheDocument();
    // Agents is selected by default; the Agents view renders
    expect(screen.getByRole("tab", { name: "Agents" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Skills" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("ALL_AGENTS")).toBeInTheDocument();
    expect(screen.queryByText("ALL_SKILLS")).not.toBeInTheDocument();
  });

  it("renders the per-agent dashboard verbatim when ?agent= is present", () => {
    renderPage("?agent=a1");
    expect(screen.getByText("AGENT_DASH:a1")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Agents" })).toHaveAttribute("aria-selected", "true");
  });

  it("selects the Skills tab for ?tab=skills and shows the all-skills overview", () => {
    renderPage("?tab=skills");
    expect(screen.getByRole("tab", { name: "Skills" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("ALL_SKILLS")).toBeInTheDocument();
    expect(screen.queryByText("ALL_AGENTS")).not.toBeInTheDocument();
  });

  it("treats a bare ?skill= as the Skills tab and shows the per-skill dashboard", () => {
    renderPage("?skill=sk1");
    expect(screen.getByRole("tab", { name: "Skills" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("SKILL_DASH:sk1")).toBeInTheDocument();
  });

  it("navigates via the URL when a tab is clicked", () => {
    renderPage("");
    fireEvent.click(screen.getByRole("tab", { name: "Skills" }));
    expect(push).toHaveBeenCalledWith("/eval?tab=skills");
    fireEvent.click(screen.getByRole("tab", { name: "Agents" }));
    expect(push).toHaveBeenCalledWith("/eval");
  });
});
