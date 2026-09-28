import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { iotConnectors } from "@db/schema";
import { appRouter } from "../router";
import { webhookWorkspaceId } from "../services/iot/iotIngestion";
import { nudgeIotConsumer } from "../services/iot/iotConsumer";
import {
  createMockContext,
  mockAdminUser,
  mockViewerUser,
  mockWorkspace,
  mockAdminMembership,
  mockViewerMembership,
} from "./testHarness";

const store = vi.hoisted(() => ({ tables: new Map<string, Record<string, unknown>[]>() }));
vi.mock("../queries/connection", async () => ({ getDb: (await import("./memoryDb")).memoryDbFor(store.tables) }));
vi.mock("../services/iot/iotConsumer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/iot/iotConsumer")>()),
  nudgeIotConsumer: vi.fn(),
}));

vi.mock("../services/iot/iotIngestion", () => ({
  ingestTelemetry: vi.fn().mockResolvedValue({
    success: true,
    receivedCount: 1,
    updatedTwins: [{ twinIri: "dtwin:Shipment/SHP-1004", updatedKeys: ["temperature"] }],
    errors: [],
  }),
  webhookWorkspaceId: vi.fn(),
  sampleDeviceId: vi.fn().mockResolvedValue("dtwin:log/shipment-shp-001"),
}));

const TEST_KEY = "test-webhook-key-0123456789abcdef";

describe("IoT Router Integration Tests", () => {
  beforeEach(() => {
    process.env.IOT_WEBHOOK_API_KEY = TEST_KEY;
    vi.mocked(webhookWorkspaceId).mockResolvedValue(mockWorkspace.id);
  });
  afterEach(() => {
    delete process.env.IOT_WEBHOOK_API_KEY;
  });

  const callerAs = (user: typeof mockAdminUser, membership: typeof mockAdminMembership) =>
    appRouter.createCaller(createMockContext({ user, membership, workspace: mockWorkspace }));

  it("returns webhook configuration to a workspace member, with the key hidden from a viewer", async () => {
    const config = await callerAs(mockViewerUser, mockViewerMembership).iot.getWebhookConfig();
    expect(config.endpointUrl).toBe("/api/iot/telemetry");
    expect(config.workspaceSlug).toBe(mockWorkspace.slug);
    expect(config.configured).toBe(true);
    expect(config.apiKey).not.toContain(TEST_KEY);
    expect(config.sampleCurl).not.toContain(TEST_KEY);
  });

  it("shows the key to an admin of the workspace it is bound to", async () => {
    const config = await callerAs(mockAdminUser, mockAdminMembership).iot.getWebhookConfig();
    expect(config.apiKey).toBe(TEST_KEY);
    expect(config.sampleCurl).toContain(TEST_KEY);
    expect(config.sampleCurl).toContain("dtwin:log/shipment-shp-001");
  });

  it("reports the webhook as unconfigured in a workspace the key is not bound to", async () => {
    vi.mocked(webhookWorkspaceId).mockResolvedValue(mockWorkspace.id + 1);
    const config = await callerAs(mockAdminUser, mockAdminMembership).iot.getWebhookConfig();
    expect(config.configured).toBe(false);
    expect(config.apiKey).not.toContain(TEST_KEY);
  });

  it("ingests telemetry points via tRPC mutation", async () => {
    const caller = appRouter.createCaller(
      createMockContext({
        user: mockAdminUser,
        membership: mockAdminMembership,
        workspace: mockWorkspace,
      }),
    );

    const result = await caller.iot.ingestTelemetry({
      points: [
        {
          deviceId: "SHP-1004",
          telemetry: { temperature: 4.2 },
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.receivedCount).toBe(1);
  });

  it("rejects unauthenticated caller from getting webhook config", async () => {
    const caller = appRouter.createCaller(createMockContext({ user: null, workspace: null, membership: null }));
    await expect(caller.iot.getWebhookConfig()).rejects.toThrow("Authentication required");
  });
});

describe("broker connectors: what admins set, and what the IoT consumer observed", () => {
  const at = new Date("2026-01-01T00:00:00Z");
  const connector = (id: number, over: Record<string, unknown> = {}) => ({
    id, workspaceId: mockWorkspace.id, name: `Broker ${id}`, brokerType: "mqtt", endpointUrl: "mqtt://broker.test:1883", topicPattern: null,
    clientId: null, authType: "none", configJson: {}, enabled: true, configVersion: 1, status: "disconnected", lastConnectedAt: null,
    messageCount: 0, errorCount: 0, lastError: null, observedVersion: null, consumerOwner: null, observedAt: null, createdAt: new Date(at.getTime() + id),
    ...over,
  });
  const admin = () => appRouter.createCaller(createMockContext({ user: mockAdminUser, membership: mockAdminMembership, workspace: mockWorkspace }));
  const rows = () => store.tables.get(getTableName(iotConnectors)) ?? [];

  beforeEach(() => {
    store.tables.clear();
    vi.mocked(nudgeIotConsumer).mockClear();
  });

  it("a broker is connecting until the consumer reports on its current settings, then is as it observed", async () => {
    store.tables.set(getTableName(iotConnectors), [
      connector(1, { configVersion: 2, observedVersion: 1, status: "connected" }),
      connector(2, { configVersion: 3, observedVersion: 3, status: "connected", messageCount: 42 }),
      connector(3, { enabled: false, configVersion: 4, observedVersion: 3, status: "connected" }),
      connector(4, { configVersion: 1, observedVersion: 1, status: "error", lastError: "connack timeout" }),
      connector(5, { brokerType: "webhook", enabled: true }),
    ]);
    const listed = await admin().iot.listConnectors();
    expect(listed.map((c) => [c.id, c.status, c.pending])).toEqual([
      [5, "connected", false],
      [4, "error", false],
      [3, "disconnecting", true],
      [2, "connected", false],
      [1, "connecting", true],
    ]);
    expect(listed.find((c) => c.id === 2)?.messageCount).toBe(42);
  });

  it("saving, switching and deleting write what the connector should do, bump its settings version, and wake this process's consumer", async () => {
    const saved = await admin().iot.upsertConnector({ name: "Plant", brokerType: "mqtt", endpointUrl: "mqtt://plant.test:1883", protocolVersion: 5 });
    expect(saved).toEqual({ success: true, id: 1, pending: true });
    expect(rows()[0]).toMatchObject({ enabled: true, configVersion: 1, status: "disconnected", configJson: { protocolVersion: 5 } });

    await admin().iot.upsertConnector({ id: 1, name: "Plant", brokerType: "mqtt", endpointUrl: "mqtt://plant.test:1883", connectNow: false });
    expect(rows()[0]).toMatchObject({ enabled: false, configVersion: 2, configJson: {} });

    expect(await admin().iot.toggleConnector({ id: 1, enable: true })).toEqual({ success: true, enabled: true, pending: true });
    expect(rows()[0]).toMatchObject({ enabled: true, configVersion: 3 });

    expect(await admin().iot.deleteConnector({ id: 1 })).toEqual({ success: true, pending: true });
    expect(rows()).toEqual([]);
    expect(nudgeIotConsumer).toHaveBeenCalledTimes(4);
  });

  it("a webhook connector connects to nothing, so nothing is pending", async () => {
    const saved = await admin().iot.upsertConnector({ name: "Hook", brokerType: "webhook", endpointUrl: "https://edge.test/hook" });
    expect(saved.pending).toBe(false);
    expect(await admin().iot.toggleConnector({ id: saved.id!, enable: false })).toMatchObject({ enabled: false, pending: false });
  });
});
