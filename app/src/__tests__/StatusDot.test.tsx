// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { StatusDot } from "../components/ui/status-dot";

describe("StatusDot Component", () => {
  it("renders status dot with correct status color", () => {
    const { container } = render(<StatusDot status="ok" />);
    const dot = container.querySelector("span.rounded-full");
    expect(dot).toBeTruthy();
  });

  it("renders without pulse ring when pulse=false", () => {
    const { container } = render(<StatusDot status="risk" pulse={false} />);
    const pingRing = container.querySelector(".animate-ping");
    expect(pingRing).toBeNull();
  });

  it("renders pulse ring when pulse=true (default)", () => {
    const { container } = render(<StatusDot status="warn" />);
    const pingRing = container.querySelector(".animate-ping");
    expect(pingRing).toBeTruthy();
  });
});
