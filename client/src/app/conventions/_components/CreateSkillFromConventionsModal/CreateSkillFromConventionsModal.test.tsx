import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../messages/en/conventions.json";
import { ToastProvider } from "@/lib/toast";

const createMutate = vi.fn();
const linkMutate = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/skills", () => ({
  useCreateSkill: () => ({ mutateAsync: createMutate, isPending: false }),
}));
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => ({ data: [] }) }));
vi.mock("@/lib/hooks/conventions", () => ({
  useLinkAgentSkill: () => ({ mutateAsync: linkMutate, isPending: false }),
}));

import { CreateSkillFromConventionsModal } from "./CreateSkillFromConventionsModal";

afterEach(cleanup);
beforeEach(() => {
  createMutate.mockReset();
  linkMutate.mockReset();
  let n = 0;
  createMutate.mockImplementation(async () => ({ id: `sk${++n}` }));
});

function cand(over: Partial<ConventionCandidate>): ConventionCandidate {
  return {
    id: "c1",
    rule: "Use X",
    evidence_path: "a.ts",
    evidence_snippet: "x",
    confidence: 0.9,
    accepted: true,
    category: null,
    source: "llm",
    occurrences: null,
    extracted_at: null,
    ...over,
  };
}

const CANDIDATES: ConventionCandidate[] = [
  cand({ id: "1", category: "formatting", evidence_path: "a.ts" }),
  cand({ id: "2", category: "imports", evidence_path: "b.ts" }),
  cand({ id: "3", category: "imports", evidence_path: "c.ts" }),
];

function renderModal() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ToastProvider>
        <CreateSkillFromConventionsModal
          repoName="dev-digest"
          candidates={CANDIDATES}
          onClose={() => {}}
        />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("CreateSkillFromConventionsModal — per-category mode", () => {
  it("per-category preview lists one row per category", () => {
    renderModal();
    fireEvent.click(screen.getByText("One skill per category"));
    expect(screen.getByText("formatting")).toBeInTheDocument();
    expect(screen.getByText("imports")).toBeInTheDocument();
    // Rendered in both the modal subtitle and the preview hint.
    expect(screen.getAllByText("2 skills will be created").length).toBeGreaterThan(0);
  });

  it("submit creates one skill per category with the suffixed names", async () => {
    renderModal();
    fireEvent.click(screen.getByText("One skill per category"));
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(2));
    expect(createMutate.mock.calls[0]![0].name).toBe("dev-digest-conventions-formatting");
    expect(createMutate.mock.calls[1]![0].name).toBe("dev-digest-conventions-imports");
    expect(createMutate.mock.calls[1]![0].evidence_files).toEqual(["b.ts", "c.ts"]);
  });

  it("partial failure → 'Created 1 of 2 skills' toast, earlier skill kept", async () => {
    createMutate.mockReset();
    createMutate.mockResolvedValueOnce({ id: "sk1" }).mockRejectedValueOnce(new Error("boom"));
    renderModal();
    fireEvent.click(screen.getByText("One skill per category"));
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));
    await waitFor(() => expect(screen.getByText("Created 1 of 2 skills")).toBeInTheDocument());
  });
});
