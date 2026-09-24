// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { StatusDot, type StatusKind } from "../components/ui/status-dot";

// STATUS_COLORS in status-dot.tsx, as jsdom normalises them (hex → rgb)
const EXPECTED: [StatusKind, string, string][] = [
  ["ok", "#34D399", "rgb(52, 211, 153)"],
  ["warn", "#FBBF24", "rgb(251, 191, 36)"],
  ["risk", "#F87171", "rgb(248, 113, 113)"],
  ["info", "#38BDF8", "rgb(56, 189, 248)"],
  ["idle", "#64748B", "rgb(100, 116, 139)"],
];

function parts(container: HTMLElement) {
  const wrapper = container.firstElementChild as HTMLElement;
  const dot = wrapper.querySelector<HTMLElement>(":scope > span.relative.rounded-full");
  const ring = wrapper.querySelector<HTMLElement>(":scope > span.animate-ping");
  return { wrapper, dot, ring };
}

describe("StatusDot Component", () => {
  it.each(EXPECTED)("paints the '%s' dot and its pulse ring %s", (status, _hex, rgb) => {
    const { container } = render(<StatusDot status={status} />);
    const { dot, ring } = parts(container);
    expect(dot).not.toBeNull();
    expect(dot!.style.backgroundColor).toBe(rgb);
    expect(ring).not.toBeNull();
    expect(ring!.style.backgroundColor).toBe(rgb);
  });

  it("gives every status a distinct color", () => {
    const colors = EXPECTED.map(([status]) => {
      const { container, unmount } = render(<StatusDot status={status} />);
      const color = parts(container).dot!.style.backgroundColor;
      unmount();
      return color;
    });
    expect(new Set(colors).size).toBe(EXPECTED.length);
  });

  it("renders without pulse ring when pulse=false", () => {
    const { container } = render(<StatusDot status="risk" pulse={false} />);
    const pingRing = container.querySelector(".animate-ping");
    expect(pingRing).toBeNull();
    expect(parts(container).dot!.style.backgroundColor).toBe("rgb(248, 113, 113)");
  });

  it("renders pulse ring when pulse=true (default)", () => {
    const { container } = render(<StatusDot status="warn" />);
    const { ring } = parts(container);
    expect(ring).toBeTruthy();
    expect(ring!.getAttribute("aria-hidden")).toBe("true");
  });

  it("merges a caller className and forwards span attributes onto the wrapper", () => {
    const { container } = render(<StatusDot status="ok" className="ml-2" title="Healthy" data-testid="dot" />);
    const { wrapper } = parts(container);
    expect(wrapper.className).toContain("ml-2");
    expect(wrapper.className).toContain("size-2");
    expect(wrapper.getAttribute("title")).toBe("Healthy");
    expect(wrapper.getAttribute("data-testid")).toBe("dot");
  });
});
