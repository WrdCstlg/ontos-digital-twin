// @vitest-environment jsdom
/**
 * The sidebar shows the person's role in this workspace, which decides what
 * they may do here, not their account's own role; and offers Admin to this
 * workspace's admins, whatever their account.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { MemoryRouter, Route, Routes } from "react-router";
import type { AppRouter } from "../../api/router";
import { trpc } from "@/providers/trpc";
import { AppShell } from "@/components/AppShell";

// The account is an ontologist; what the workspace says is set per test.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, name: "Ada Lovelace", email: "ada@acme.com", role: "ontologist" },
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

let workspaceRole = "viewer";
const server: TRPCLink<AppRouter> = () => ({ op }) =>
  observable((observer) => {
    observer.next({ result: { type: "data", data: op.path === "auth.membership" ? { role: workspaceRole } : null } } as never);
    observer.complete();
  });

beforeAll(() => {
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

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [server] });
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
}

describe("the sidebar", () => {
  it("shows the role in this workspace, not the account's, and no Admin to a viewer", async () => {
    workspaceRole = "viewer";
    renderShell();
    await waitFor(() => expect(screen.getByText("Viewer")).toBeTruthy());
    expect(screen.queryByText("Ontologist")).toBeNull();
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
  });

  it("offers Admin to this workspace's admin, whatever their account's role", async () => {
    workspaceRole = "admin";
    renderShell();
    await waitFor(() => expect(screen.getByRole("link", { name: "Admin" })).toBeTruthy());
    // The role chip, beside the nav item of the same name.
    expect(screen.getAllByText("Admin", { selector: "span" }).some((el) => el.className.includes("rounded-full"))).toBe(true);
  });
});
