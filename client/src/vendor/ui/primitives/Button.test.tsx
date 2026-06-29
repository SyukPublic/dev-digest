import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Button } from "./Button";

afterEach(cleanup);

// Issue #9: functional spinners must carry the `.dd-spin` marker class so the
// reduced-motion media query can re-enable them (the blanket `*` reset would
// otherwise freeze them). We assert the class is present rather than the
// keyframe runs (jsdom doesn't run CSS animations).
describe("Button loading spinner (dd-spin marker)", () => {
  it("renders the loading icon with the .dd-spin class while loading", () => {
    render(<Button loading>Save</Button>);
    // The loading icon is a RefreshCw SVG; lucide forwards className onto it.
    const button = screen.getByRole("button", { name: /save/i });
    const spinner = button.querySelector("svg.dd-spin");
    expect(spinner).not.toBeNull();
  });

  it("does NOT spin (no .dd-spin) when not loading", () => {
    render(
      <Button icon="Check" loading={false}>
        Done
      </Button>,
    );
    const button = screen.getByRole("button", { name: /done/i });
    expect(button.querySelector("svg.dd-spin")).toBeNull();
    // The configured icon still renders.
    expect(button.querySelector("svg")).not.toBeNull();
  });
});
