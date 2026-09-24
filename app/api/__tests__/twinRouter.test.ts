import { describe, expect, it, vi } from "vitest";
import { appRouter } from "../router";
import { TWIN_MODELS, dtmiFor } from "../services/twinModels";
import { writeAudit } from "../services/audit";
import {
  createMockContext,
  mockViewerUser,
  mockViewerMembership,
  mockWorkspace,
} from "./testHarness";

vi.mock("../queries/connection", () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn().mockResolvedValue([{ affectedRows: 3 }]),
    })),
  })),
}));

vi.mock("../services/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/audit")>();
  return { ...actual, writeAudit: vi.fn().mockResolvedValue(undefined) };
});

describe("Twin Router & DTDL v3 Export Tests", () => {
  it("exports all registered twin models as DTDL v3 interfaces when no IRI is specified", async () => {
    const caller = appRouter.createCaller(
      createMockContext({
        user: mockViewerUser,
        membership: mockViewerMembership,
        workspace: mockWorkspace,
      }),
    );

    const result = await caller.twin.exportDtdl();

    expect(result.forTwin).toBeNull();
    expect(result.models).toHaveLength(TWIN_MODELS.length);
    expect(result.models).toContain(dtmiFor("ShipmentTwin"));
    expect(result.models).toContain(dtmiFor("WarehouseTwin"));
    expect(result.models).toContain(dtmiFor("EquipmentTwin"));

    const parsed = JSON.parse(result.content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(TWIN_MODELS.length);

    // Validate DTDL v3 Interface structure on each exported model
    for (const iface of parsed) {
      expect(iface["@context"]).toBe("dtmi:dtdl:context;3");
      expect(iface["@type"]).toBe("Interface");
      expect(iface["@id"]).toMatch(/^dtmi:acme:[a-z]+:[A-Za-z0-9]+;1$/);
      expect(typeof iface.displayName).toBe("string");
      expect(Array.isArray(iface.contents)).toBe(true);

      for (const item of iface.contents) {
        expect(["Property", "Telemetry", "Relationship", "Component"]).toContain(item["@type"]);
        expect(typeof item.name).toBe("string");

        if (item["@type"] === "Telemetry") {
          expect(item.schema).toBe("double");
          expect(typeof item.unit).toBe("string");
        }
        if (item["@type"] === "Relationship") {
          expect(item["@id"]).toBeDefined();
        }
      }
    }
  });

  it("verifies telemetry unit mappings conform to DTDL standard units", async () => {
    const caller = appRouter.createCaller(
      createMockContext({
        user: mockViewerUser,
        membership: mockViewerMembership,
        workspace: mockWorkspace,
      }),
    );

    interface DtdlTelemetryItem {
      "@type": string;
      name: string;
      schema?: string;
      unit?: string;
    }

    interface DtdlInterface {
      "@id": string;
      "@type": string;
      "@context": string;
      displayName: string;
      contents: DtdlTelemetryItem[];
    }

    const result = await caller.twin.exportDtdl();
    const interfaces = JSON.parse(result.content) as DtdlInterface[];

    const shipment = interfaces.find((i) => i["@id"] === dtmiFor("ShipmentTwin"));
    expect(shipment).toBeDefined();

    const tempTelemetry = shipment?.contents.find(
      (c) => c["@type"] === "Telemetry" && c.name === "temperature",
    );
    expect(tempTelemetry).toBeDefined();
    expect(tempTelemetry?.unit).toBe("degreeCelsius");

    const equipment = interfaces.find((i) => i["@id"] === dtmiFor("EquipmentTwin"));
    expect(equipment).toBeDefined();
    const batteryTelemetry = equipment?.contents.find(
      (c) => c["@type"] === "Telemetry" && c.name === "batteryLevel",
    );
    expect(batteryTelemetry).toBeDefined();
    expect(batteryTelemetry?.unit).toBe("percent");
  });

  it("returns the deletion count from pruneStateHistory and records it in the audit entry", async () => {
    const caller = appRouter.createCaller(
      createMockContext({
        user: mockViewerUser,
        membership: { ...mockViewerMembership, role: "admin" },
        workspace: mockWorkspace,
      }),
    );

    const result = await caller.twin.pruneStateHistory({ olderThanDays: 30 });

    expect(result.deletedCount).toBe(3);
    expect(typeof result.cutoff).toBe("string");

    expect(vi.mocked(writeAudit)).toHaveBeenCalledOnce();
    const auditEntry = vi.mocked(writeAudit).mock.calls[0][0];
    expect(auditEntry.payload).toMatchObject({ olderThanDays: 30, deletedCount: 3 });
    expect(auditEntry.action).toContain("3 rows deleted");
  });

  it("rejects unauthenticated caller from exporting DTDL models", async () => {
    const caller = appRouter.createCaller(
      createMockContext({ user: null, workspace: null, membership: null }),
    );

    await expect(caller.twin.exportDtdl()).rejects.toThrow("Authentication required");
  });
});
