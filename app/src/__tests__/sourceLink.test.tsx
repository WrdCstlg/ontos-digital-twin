// @vitest-environment jsdom
/**
 * AGPL section 13: everyone who uses Ontos over a network is offered its
 * source. The sign-in page, which every user reaches, links to it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { trpc } from "@/providers/trpc";
import Login from "@/pages/Login";
import { LICENSE_NAME, SOURCE_URL } from "@/lib/source";

afterEach(() => cleanup());

describe("the source code link", () => {
  it("is on the sign-in page, naming the licence, and opens the source", () => {
    const queryClient = new QueryClient();
    const client = trpc.createClient({ links: [] });
    render(
      <trpc.Provider client={client} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/login"]}>
            <Login />
          </MemoryRouter>
        </QueryClientProvider>
      </trpc.Provider>,
    );
    const link = screen.getByRole("link", { name: `Source code (${LICENSE_NAME})` });
    expect(link.getAttribute("href")).toBe(SOURCE_URL);
    expect(LICENSE_NAME).toBe("AGPL-3.0");
    expect(SOURCE_URL).toMatch(/^https:\/\//);
  });
});
