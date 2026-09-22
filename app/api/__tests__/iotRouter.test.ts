import { describe, expect, it, vi } from "vitest";
import { appRouter } from "../router";
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
}));

describe("IoT Router Integration Tests", () => {
  it("returns webhook configuration for authenticated workspace caller", async () => {
    const caller = appRouter.createCaller(
      createMockContext({
        user: mockViewerUser,
        membership: mockViewerMembership,
        workspace: mockWorkspace,
      }),
    );

    const config = await caller.iot.getWebhookConfig();
    expect(config).toBeDefined();
    expect(config.endpointUrl).toBe("/api/iot/telemetry");
    expect(config.workspaceSlug).toBe(mockWorkspace.slug);
    expect(config.apiKey).toBeDefined();
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
