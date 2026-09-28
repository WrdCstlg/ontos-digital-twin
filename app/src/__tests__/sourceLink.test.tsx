// @vitest-environment jsdom
/**
 * AGPL section 13: everyone who uses Ontos over a network is offered the
 * source of the version they use: on the landing page (its footer), the
 * sign-in page and in the app (its sidebar; appShellSourceLink.test.tsx).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { trpc } from "@/providers/trpc";
import Login from "@/pages/Login";
import { Footer } from "@/components/Footer";
import { LICENSE_NAME, SOURCE_URL, UPSTREAM_SOURCE, sourceUrl } from "@/lib/source";

afterEach(() => cleanup());

function withProviders(node: React.ReactNode, path = "/") {
  const queryClient = new QueryClient();
  const client = trpc.createClient({ links: [] });
  return render(
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

describe("the source code link", () => {
  it("leads upstream by default, to the build's commit when it is known, and to a deployment's own source when set", () => {
    expect(UPSTREAM_SOURCE).toBe("https://github.com/WrdCstlg/ontos-digital-twin");
    expect(sourceUrl({})).toBe(UPSTREAM_SOURCE);
    expect(sourceUrl({ VITE_SOURCE_COMMIT: "c9efb94" })).toBe(`${UPSTREAM_SOURCE}/tree/c9efb94`);
    expect(sourceUrl({ VITE_SOURCE_COMMIT: "not a commit" })).toBe(UPSTREAM_SOURCE);
    expect(sourceUrl({ VITE_SOURCE_URL: "https://git.example.com/acme/ontos", VITE_SOURCE_COMMIT: "c9efb94" })).toBe(
      "https://git.example.com/acme/ontos",
    );
    expect(LICENSE_NAME).toBe("AGPL-3.0");
  });

  it("is on the sign-in page, naming the licence", () => {
    withProviders(<Login />, "/login");
    expect(screen.getByRole("link", { name: `Source code (${LICENSE_NAME})` }).getAttribute("href")).toBe(SOURCE_URL);
  });

  it("is on the landing page, in its footer, beside the copyright", () => {
    withProviders(<Footer />);
    const link = screen.getByRole("link", { name: `Source code (${LICENSE_NAME})` });
    expect(link.getAttribute("href")).toBe(SOURCE_URL);
    expect(link.closest("span")?.textContent).toMatch(/© 2026 Senan Sumrein and Pierce Partners/);
  });
});
