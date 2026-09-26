// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { MemoryRouter } from "react-router";
import type { AppRouter } from "../../api/router";
import Developers from "@/pages/Developers";
import { createAppQueryClient, createAppTrpcClient, trpc } from "@/providers/trpc";

/** A fake server: the developer procedures over tRPC, and /api/v1 over fetch. */
const server = {
  tokens: [] as Record<string, unknown>[],
  created: [] as unknown[],
  revoked: [] as number[],
  apiCalls: [] as { url: string; credentials?: RequestCredentials }[],
  sdkFails: false,
};

const summary = {
  basePath: "/api/v1",
  ontologyVersion: "a1b2c3d4e5f6",
  objectTypes: 42,
  actionTypes: 4,
  canManageAll: true,
  example: { objectType: { iri: "hr:Person", path: "/objects/hr/Person" }, action: { key: "renew-contract", params: [{ name: "contract", type: "object" }, { name: "newEndDate", type: "date" }] } },
};

const fakeLink: TRPCLink<AppRouter> = () => ({ op }) =>
  observable((observer) => {
    const ok = (data: unknown) => {
      observer.next({ result: { type: "data", data } } as never);
      observer.complete();
    };
    const input = op.input as Record<string, unknown>;
    switch (op.path) {
      case "developer.summary":
        return ok(summary);
      case "developer.listTokens":
        return ok(server.tokens);
      case "developer.createToken": {
        server.created.push(input);
        if (input.name === "too high") {
          return observer.error(TRPCClientError.from({ error: { message: "A token cannot have a higher role (admin) than its creator", code: -32000, data: { code: "FORBIDDEN" } } } as never));
        }
        const row = { id: server.tokens.length + 1, name: input.name, prefix: "ontos_abcdefgh", role: input.role, scopes: input.scopes, createdBy: "Elena", createdByUserId: 1, lastUsedAt: null, expiresAt: null, revokedAt: null, mine: true };
        server.tokens = [row, ...server.tokens];
        return ok({ token: "ontos_abcdefgh_" + "Z".repeat(32), row });
      }
      case "developer.revokeToken":
        server.revoked.push(input.id as number);
        server.tokens = server.tokens.map((t) => (t.id === input.id ? { ...t, revokedAt: new Date() } : t));
        return ok({ revoked: true });
      default:
        return observer.error(TRPCClientError.from({ error: { message: `unexpected ${op.path}`, code: -32000, data: { code: "NOT_FOUND" } } } as never));
    }
  });

function renderPage() {
  const queryClient = createAppQueryClient();
  return render(
    <trpc.Provider client={createAppTrpcClient([fakeLink])} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Developers />
        </MemoryRouter>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

beforeEach(() => {
  Object.assign(server, { tokens: [], created: [], revoked: [], apiCalls: [], sdkFails: false });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    server.apiCalls.push({ url, credentials: init?.credentials });
    if (url === "/api/v1/openapi.json") {
      return new Response(JSON.stringify({ paths: { "/objects/hr/Person": { get: { summary: "Person objects", tags: ["HR"] } }, "/actions/renew-contract/submit": { post: { summary: "Submit: Renew contract", tags: ["Actions"] } } } }), { headers: { "content-type": "application/json" } });
    }
    if (url === "/api/v1/sdk.ts") {
      return server.sdkFails
        ? new Response(JSON.stringify({ error: { code: "unavailable", message: "The ontology could not be loaded just now." } }), { status: 503 })
        : new Response("export const ONTOLOGY_VERSION = 'a1b2c3d4e5f6';", { headers: { "content-type": "text/plain" } });
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:sdk"), revokeObjectURL: vi.fn() }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Developers page", () => {
  it("shows where the API is, the ontology it serves, and its endpoints", async () => {
    renderPage();
    expect(await screen.findByText("a1b2c3d4e5f6")).toBeTruthy();
    expect(screen.getByText(`${window.location.origin}/api/v1`)).toBeTruthy();
    expect(screen.getByText("42 object types · 4 action types")).toBeTruthy();
    const endpoints = await screen.findByRole("list", { name: "Endpoints" });
    expect(within(endpoints).getByText("/objects/hr/Person")).toBeTruthy();
    expect(within(endpoints).getByText("POST")).toBeTruthy();
    // The page reads the API with the session.
    expect(server.apiCalls.find((c) => c.url === "/api/v1/openapi.json")?.credentials).toBe("include");
  });

  it("writes its examples with this ontology's own names", async () => {
    renderPage();
    await screen.findByText("a1b2c3d4e5f6");
    expect(screen.getByText(/ontos\.iterate\("hr:Person"\)/)).toBeTruthy();
    expect(screen.getByText(/actions\.submit\("renew-contract"/)).toBeTruthy();
    expect(screen.getByText(/\/api\/v1\/objects\/hr\/Person\?limit=5/)).toBeTruthy();
  });

  it("creates a token and shows it once", async () => {
    renderPage();
    await screen.findByText("No tokens yet.");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Contracts sync" } });
    fireEvent.click(screen.getByRole("button", { name: /Create token/ }));
    const shown = await screen.findByTestId("new-token");
    expect(shown.textContent).toBe("ontos_abcdefgh_" + "Z".repeat(32));
    expect(server.created[0]).toEqual({ name: "Contracts sync", role: "viewer", scopes: ["read"], expiresInDays: 90, moduleScope: null });
    // The list shows only its prefix; once dismissed, the full value is gone from the page.
    expect(await screen.findByText("ontos_abcdefgh…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "I have stored it" }));
    expect(screen.queryByTestId("new-token")).toBeNull();
    expect(document.body.textContent).not.toContain("Z".repeat(32));
  });

  it("sends the scopes, role, expiry and modules chosen, and shows a refusal's reason", async () => {
    renderPage();
    await screen.findByText("No tokens yet.");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "too high" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText("Expires"), { target: { value: "never" } });
    fireEvent.click(screen.getByLabelText("Submit actions"));
    fireEvent.change(screen.getByLabelText("Modules (optional)"), { target: { value: " hr, legal ,," } });
    fireEvent.click(screen.getByRole("button", { name: /Create token/ }));
    expect(await screen.findByText("A token cannot have a higher role (admin) than its creator")).toBeTruthy();
    expect(server.created[0]).toEqual({ name: "too high", role: "admin", scopes: ["read", "actions"], expiresInDays: null, moduleScope: ["hr", "legal"] });
    expect(screen.queryByTestId("new-token")).toBeNull();
  });

  it("will not create a token without a name or a scope", async () => {
    renderPage();
    await screen.findByText("No tokens yet.");
    const create = screen.getByRole("button", { name: /Create token/ }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "x" } });
    fireEvent.click(screen.getByLabelText("Read objects"));
    expect(create.disabled).toBe(true);
  });

  it("revokes a token only after asking", async () => {
    server.tokens = [{ id: 7, name: "Old sync", prefix: "ontos_oldoldol", role: "viewer", scopes: ["read"], createdBy: "Elena", createdByUserId: 1, lastUsedAt: null, expiresAt: null, revokedAt: null, mine: true }];
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    expect(server.revoked).toEqual([]);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(server.revoked).toEqual([7]));
    expect(await screen.findByText("Revoked")).toBeTruthy();
  });

  it("downloads the generated client with the session, and says why when it cannot", async () => {
    renderPage();
    await screen.findByText("a1b2c3d4e5f6");
    fireEvent.click(screen.getByRole("button", { name: /TypeScript client/ }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(server.apiCalls.find((c) => c.url === "/api/v1/sdk.ts")?.credentials).toBe("include");
    server.sdkFails = true;
    fireEvent.click(screen.getByRole("button", { name: /TypeScript client/ }));
    expect(await screen.findByText("The ontology could not be loaded just now.")).toBeTruthy();
  });
});
