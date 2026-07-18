import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import common from "../../../messages/en/common.json";
import { PeriodControl } from "./PeriodControl";
import { DEFAULT_PERIOD, type StatsPeriod } from "@/lib/period";

afterEach(cleanup);

function renderControl(value: StatsPeriod, onChange = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ common }}>
      <PeriodControl value={value} onChange={onChange} />
    </NextIntlClientProvider>,
  );
  return onChange;
}

describe("PeriodControl (AC-10/36)", () => {
  it("marks the active window and switches to 1 day", () => {
    const onChange = renderControl(DEFAULT_PERIOD);
    expect(screen.getByRole("button", { name: /30 days/i })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /1 day/i }));
    expect(onChange).toHaveBeenCalledWith({ kind: "days", days: 1 });
  });

  it("is a labeled, keyboard-operable group of native buttons", () => {
    renderControl(DEFAULT_PERIOD);
    expect(screen.getByRole("group", { name: /period/i })).toBeInTheDocument();
    // all controls are real <button>s (focusable / keyboard-operable)
    expect(screen.getByRole("button", { name: /custom/i })).toBeInTheDocument();
  });

  it("reveals a custom range and emits it on Apply", () => {
    const onChange = renderControl(DEFAULT_PERIOD);
    fireEvent.click(screen.getByRole("button", { name: /custom/i }));

    fireEvent.change(screen.getByLabelText(/from/i), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByLabelText(/to/i), { target: { value: "2026-07-10" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    expect(onChange).toHaveBeenCalledWith({ kind: "range", from: "2026-07-01", to: "2026-07-10" });
  });
});
