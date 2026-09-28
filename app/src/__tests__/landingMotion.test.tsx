// @vitest-environment jsdom
/**
 * The landing page's motion, made with framer-motion (GSAP's licence is not
 * compatible with the AGPL). Each section renders its content whether it
 * animates or is still: with reduced motion, and on a narrow screen, the
 * problem section shows its connected cluster as it ends.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Hero } from "@/components/home/Hero";
import { ProblemSection } from "@/components/home/ProblemSection";

// The WebGL constellation is not what is tested here, and jsdom has no WebGL.
vi.mock("@/components/home/HeroGraph", () => ({ default: () => null }));

/** Media queries answered as given, by query. */
function media(matches: Record<string, boolean>) {
  window.matchMedia = ((query: string) => ({
    matches: matches[query] ?? false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as never;
}

afterEach(() => cleanup());

describe("the hero", () => {
  for (const reduced of [false, true]) {
    it(`reads the whole headline and offers the demo, ${reduced ? "with" : "without"} reduced motion`, () => {
      media({ "(prefers-reduced-motion: reduce)": reduced });
      render(
        <MemoryRouter>
          <Hero />
        </MemoryRouter>,
      );
      expect(screen.getByRole("heading", { level: 1, name: "Your enterprise already has the data. Ontos gives it meaning." })).toBeTruthy();
      expect(screen.getByRole("link", { name: /Launch the Acme Demo/ })).toBeTruthy();
    });
  }
});

describe("the problem section", () => {
  it("animates on a wide screen, the stage held in a scroll track", () => {
    media({ "(min-width: 1024px)": true });
    const { container } = render(<ProblemSection />);
    expect(screen.getByText("One graph. Every function.")).toBeTruthy();
    expect(container.querySelector(".sticky")).not.toBeNull();
  });

  it("shows the connected cluster as it ends on a narrow screen, or with reduced motion", () => {
    const still: Record<string, boolean>[] = [{}, { "(min-width: 1024px)": true, "(prefers-reduced-motion: reduce)": true }];
    for (const matches of still) {
      media(matches);
      const { container, unmount } = render(<ProblemSection />);
      expect(container.querySelector(".sticky"), JSON.stringify(matches)).toBeNull();
      const caption = screen.getByText("One graph. Every function.");
      expect(caption.style.opacity, JSON.stringify(matches)).toBe("1");
      for (const path of container.querySelectorAll("path")) expect(path.style.strokeDashoffset, JSON.stringify(matches)).toBe("0");
      unmount();
    }
  });
});
