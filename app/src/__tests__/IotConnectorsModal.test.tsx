// @vitest-environment jsdom
/**
 * The IoT dialog on the Twins page, against a fake server. Brokers are a
 * workspace admin's to manage and sending telemetry an editor's or above: a
 * role that may not do something is not offered it, and a refusal the server
 * gives anyway is shown, not swallowed.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { Toaster } from "sonner";
import type { AppRouter } from "../../api/router";
import { trpc } from "@/providers/trpc";
import { IotConnectorsModal } from "@/components/twins/IotConnectorsModal";

type Caps = { canManageBrokers: boolean; canIngest: boolean };
const calls: { path: string; input: unknown }[] = [];
let caps: Caps = { canManageBrokers: false, canIngest: false };
let refuse: string | null = null;

const broker = {
  id: 6, name: "Plant broker", brokerType: "mqtt", endpointUrl: "mqtts://broker.example:8883", topicPattern: null, clientId: null,
  authType: "none", enabled: true, status: "connected", pending: false, lastConnectedAt: null, messageCount: 3, errorCount: 0, lastError: null,
  observedAt: null, consumerOwner: null, hasCert: false, createdAt: new Date("2026-01-01T00:00:00Z"),
};
let listed: unknown[] = [broker];
const answers: Record<string, () => unknown> = {
  "iot.capabilities": () => caps,
  "iot.listConnectors": () => listed,
  "iot.getWebhookConfig": () => ({ endpointUrl: "/api/iot/telemetry", fullEndpointUrl: "http://localhost:3000/api/iot/telemetry", apiKey: "(hidden)", configured: false, workspaceSlug: "b", sampleCurl: "#" }),
  "iot.deleteConnector": () => ({ success: true, pending: true }),
  "iot.toggleConnector": () => ({ success: true, enabled: false, pending: true }),
};

const fakeLink: TRPCLink<AppRouter> = () => ({ op }) =>
  observable((observer) => {
    calls.push({ path: op.path, input: op.input });
    if (op.type === "mutation" && refuse) {
      observer.error(TRPCClientError.from({ error: { message: refuse, code: -32000, data: { code: "FORBIDDEN", httpStatus: 403 } } } as never));
      return;
    }
    observer.next({ result: { type: "data", data: answers[op.path]?.() ?? null } } as never);
    observer.complete();
  });

async function renderModal(as: Caps) {
  caps = as;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [fakeLink] });
  render(
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <IotConnectorsModal open onOpenChange={() => undefined} />
        <Toaster />
      </QueryClientProvider>
    </trpc.Provider>,
  );
  await screen.findByText("Plant broker");
}

async function openSandbox() {
  await act(async () => void fireEvent.mouseDown(screen.getByRole("tab", { name: /Test Sandbox/ })));
  return (await screen.findByRole("button", { name: /Send Test Ingest/ })) as HTMLButtonElement;
}

afterEach(() => {
  cleanup();
  calls.length = 0;
  refuse = null;
  listed = [broker];
});

describe("IotConnectorsModal", () => {
  it("offers a viewer no broker controls and no ingest, and says who may", async () => {
    await renderModal({ canManageBrokers: false, canIngest: false });
    expect(screen.queryByRole("button", { name: /Add Broker/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete Plant broker" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Disconnect Plant broker" })).toBeNull();
    expect(screen.getByText(/Brokers are managed by workspace admins/)).toBeTruthy();
    const send = await openSandbox();
    expect(send.disabled).toBe(true);
    expect(screen.getByText(/takes the editor role or above/)).toBeTruthy();
  });

  it("lets an editor send telemetry, but not manage brokers", async () => {
    await renderModal({ canManageBrokers: false, canIngest: true });
    expect(screen.queryByRole("button", { name: "Delete Plant broker" })).toBeNull();
    expect((await openSandbox()).disabled).toBe(false);
  });

  it("gives an admin the broker controls, and shows the server's reason when a delete is refused", async () => {
    await renderModal({ canManageBrokers: true, canIngest: true });
    expect(screen.getByRole("button", { name: /Add Broker/ })).toBeTruthy();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Delete Plant broker" })));
    expect(calls.filter((c) => c.path === "iot.deleteConnector")).toEqual([{ path: "iot.deleteConnector", input: { id: 6 } }]);

    refuse = "Insufficient permissions";
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Delete Plant broker" })));
    expect(await screen.findByText("Insufficient permissions")).toBeTruthy();
  });

  it("switches a broker by what it should do, and shows it connecting until the consumer reports", async () => {
    await renderModal({ canManageBrokers: true, canIngest: true });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Disconnect Plant broker" })));
    expect(calls.filter((c) => c.path === "iot.toggleConnector")).toEqual([{ path: "iot.toggleConnector", input: { id: 6, enable: false } }]);
    expect(await screen.findByText("Disconnecting the broker…")).toBeTruthy();

    cleanup();
    listed = [{ ...broker, status: "connecting", pending: true }];
    await renderModal({ canManageBrokers: true, canIngest: true });
    expect(screen.getByText("Connecting…")).toBeTruthy();
    expect(screen.queryByText("Connected")).toBeNull();
    // It asks again while a change is pending, and shows what the consumer reported.
    listed = [broker];
    expect(await screen.findByText("Connected", undefined, { timeout: 5000 })).toBeTruthy();
  }, 15_000);
});
