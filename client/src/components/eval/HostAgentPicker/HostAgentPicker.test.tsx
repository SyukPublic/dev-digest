import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalSkillHostCandidates } from "@devdigest/shared";
import evalMessages from "../../../../messages/en/eval.json";
import { HostAgentPicker } from "./HostAgentPicker";

let hosts: EvalSkillHostCandidates | undefined;
vi.mock("@/lib/hooks/eval", () => ({
  useSkillEvalHosts: () => ({ data: hosts }),
}));

afterEach(cleanup);

function renderPicker(props: { value: string | null; onChange: (id: string) => void; disabled?: boolean }) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <HostAgentPicker skillId="sk1" {...props} />
    </NextIntlClientProvider>,
  );
}

describe("HostAgentPicker", () => {
  it("preselects the server default_host_id (AC-4)", () => {
    hosts = {
      default_host_id: "a2",
      candidates: [
        { id: "a1", name: "Alpha", version: 3, enabled: true },
        { id: "a2", name: "Beta", version: 5, enabled: true },
      ],
    };
    const onChange = vi.fn();
    renderPicker({ value: null, onChange });
    // The picker auto-selects the resolved default so the parent has a host.
    expect(onChange).toHaveBeenCalledWith("a2");
    // The control is labelled + keyboard-operable (a native, labelled <select>).
    expect(screen.getByLabelText("Host agent")).toBeInstanceOf(HTMLSelectElement);
  });

  it("falls back to the first enabled agent when no default links the skill (AC-4)", () => {
    hosts = {
      default_host_id: null,
      candidates: [
        { id: "a1", name: "Alpha", version: 3, enabled: true },
        { id: "a2", name: "Beta", version: 5, enabled: true },
      ],
    };
    const onChange = vi.fn();
    renderPicker({ value: null, onChange });
    expect(onChange).toHaveBeenCalledWith("a1");
  });

  it("disables with a reason when zero enabled agents exist (AC-6)", () => {
    hosts = {
      default_host_id: null,
      candidates: [{ id: "a1", name: "Alpha", version: 3, enabled: false }],
    };
    const onChange = vi.fn();
    renderPicker({ value: null, onChange });
    expect(screen.getByText("No enabled agent to host")).toBeInTheDocument();
    // No host to auto-select → the parent is never handed a runnable host.
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("emits the chosen host id on change", () => {
    hosts = {
      default_host_id: "a1",
      candidates: [
        { id: "a1", name: "Alpha", version: 3, enabled: true },
        { id: "a2", name: "Beta", version: 5, enabled: true },
      ],
    };
    const onChange = vi.fn();
    renderPicker({ value: "a1", onChange });
    fireEvent.change(screen.getByLabelText("Host agent"), { target: { value: "a2" } });
    expect(onChange).toHaveBeenCalledWith("a2");
  });
});
