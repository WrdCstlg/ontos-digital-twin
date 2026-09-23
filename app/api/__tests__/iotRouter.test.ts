import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "../router";
import { webhookWorkspaceId } from "../services/iot/iotIngestion";
import {
  createMockContext,
  mockAdminUser,
  mockViewerUser,
  mockWorkspace,
  mockAdminMembership,
  mockViewerMembership,
} from "./testHarness";

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
