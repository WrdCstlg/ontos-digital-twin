// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "../components/ui/badge";

describe("Badge Component", () => {
  it("renders badge content", () => {
    render(<Badge>Enterprise v2.0</Badge>);
    expect(screen.getByText("Enterprise v2.0")).toBeTruthy();
  });

  it("applies default variant styling", () => {
    const { container } = render(<Badge>Active</Badge>);
    const badge = container.querySelector("[data-slot='badge']");
    expect(badge).toBeTruthy();
    expect(badge?.className).toContain("bg-primary");
  });

  it("applies destructive variant styling", () => {
    const { container } = render(<Badge variant="destructive">Violation</Badge>);
    const badge = container.querySelector("[data-slot='badge']");
    expect(badge).toBeTruthy();
    expect(badge?.className).toContain("bg-destructive");
  });

  it("applies outline variant styling", () => {
    const { container } = render(<Badge variant="outline">Draft</Badge>);
    const badge = container.querySelector("[data-slot='badge']");
    expect(badge).toBeTruthy();
    expect(badge?.className).toContain("text-foreground");
  });
});
