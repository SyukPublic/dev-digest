/* test_skill_editor_tabs (T39) — the SkillEditor tab strip includes an "Evals"
   tab and renders <EvalsTab> when it is active. Sibling tab bodies are stubbed so
   the test stays focused on tab wiring (they own their own hook/provider deps). */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../messages/en/skills.json";

vi.mock("./_components/ConfigTab", () => ({ ConfigTab: () => <div data-testid="config-tab" /> }));
vi.mock("./_components/ContextTab", () => ({ ContextTab: () => <div data-testid="context-tab" /> }));
vi.mock("./_components/PreviewTab", () => ({ PreviewTab: () => <div data-testid="preview-tab" /> }));
vi.mock("./_components/VersionsTab", () => ({ VersionsTab: () => <div data-testid="versions-tab" /> }));
vi.mock("./_components/EvalsTab", () => ({ EvalsTab: () => <div data-testid="evals-tab" /> }));

import { SkillEditor } from "./SkillEditor";

afterEach(() => cleanup());

const SKILL = { id: "sk1", name: "Security Rubric", version: 5 } as Skill;

function renderEditor(tab: string, onTab = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillEditor skill={SKILL} tab={tab} onTab={onTab} />
    </NextIntlClientProvider>,
  );
  return onTab;
}

describe("SkillEditor tabs (AC-1)", () => {
  it("shows the Evals tab and routes to it on click", () => {
    const onTab = renderEditor("config");
    const evalsTab = screen.getByRole("button", { name: /Evals/ });
    expect(evalsTab).toBeInTheDocument();
    // config is the active body until we switch
    expect(screen.getByTestId("config-tab")).toBeInTheDocument();
    fireEvent.click(evalsTab);
    expect(onTab).toHaveBeenCalledWith("evals");
  });

  it("renders the EvalsTab body when the evals tab is active", () => {
    renderEditor("evals");
    expect(screen.getByTestId("evals-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("config-tab")).not.toBeInTheDocument();
  });
});
