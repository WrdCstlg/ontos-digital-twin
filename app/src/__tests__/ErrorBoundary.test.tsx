// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ErrorBoundary } from "../components/ErrorBoundary";

afterEach(() => {
  cleanup();
});

function ProblematicComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Simulated fatal render error");
  }
  return <div>Component rendered safely</div>;
}

describe("ErrorBoundary Component", () => {
  it("renders children normally when no error occurs", () => {
    render(
      <ErrorBoundary>
        <ProblematicComponent shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Component rendered safely")).toBeTruthy();
  });

  it("catches thrown error and renders boundary alert message", () => {
    // Suppress expected console.error during test
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ProblematicComponent shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByText("Simulated fatal render error")).toBeTruthy();

    consoleSpy.mockRestore();
  });

  it("renders custom fallback when fallback prop is provided", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary fallback={<div>Custom fallback UI</div>}>
        <ProblematicComponent shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Custom fallback UI")).toBeTruthy();
    expect(screen.queryByText("Something went wrong")).toBeNull();

    consoleSpy.mockRestore();
  });
});
