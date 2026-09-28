// @vitest-environment jsdom
/**
 * AGPL section 13, inside the app: the sidebar offers the source of this
 * version, and names the link when the sidebar is collapsed to its icon rail.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { MemoryRouter, Route, Routes } from "react-router";
import type { AppRouter } from "../../api/router";
import { trpc } from "@/providers/trpc";
import { AppShell } from "@/components/AppShell";
import { LICENSE_NAME, SOURCE_URL } from "@/lib/source";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, name: "Ada Admin", email: "ada@acme.com", role: "admin" },
    isAuthenticated: true,
    isLoading: false,
    isReconnecting: false,
    signedOutBecause: null,
    error: null,
    logout: () => undefined,
    refresh: () => undefined,
  }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

// Every query the shell makes answers with nothing: the source link needs none of them.
const quietServer: TRPCLink<AppRouter> = () => () =>
  observable((observer) => {
    observer.next({ result: { type: "data", data: null } } as never);
    observer.complete();
  });

beforeAll(() => {
  // jsdom has neither; widgets in the shell ask for them.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as never;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

afterEach(() => cleanup());

describe("the app's source code link", () => {
  it("is in the sidebar, and keeps its name when the sidebar is collapsed to icons", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const client = trpc.createClient({ links: [quietServer] });
    render(
      <trpc.Provider client={client} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/app"]}>
            <Routes>
              <Route path="/app" element={<AppShell />}>
                <Route index element={<p>dashboard</p>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </trpc.Provider>,
    );
    const link = screen.getByRole("link", { name: `Source code (${LICENSE_NAME})` });
    expect(link.getAttribute("href")).toBe(SOURCE_URL);
    expect(link.getAttribute("title")).toBeNull();

    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" })));
    expect(screen.getByRole("link", { name: `Source code (${LICENSE_NAME})` }).getAttribute("title")).toBe(`Source code (${LICENSE_NAME})`);
  });
});
