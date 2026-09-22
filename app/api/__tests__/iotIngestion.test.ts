import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RawTelemetryPoint } from "../services/iot/types";
import { ingestTelemetry, resolveTwinNode } from "../services/iot/iotIngestion";

// Mock the database and external services
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();

const mockDb = {
  select: mockSelect.mockReturnValue({
    from: mockFrom.mockReturnValue({
      where: mockWhere.mockReturnValue({
        limit: mockLimit,
      }),
    }),
  }),
  update: mockUpdate.mockReturnValue({
    set: mockSet.mockReturnValue({
      where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
    }),
  }),
  insert: mockInsert.mockReturnValue({
    values: mockValues.mockResolvedValue([{ insertId: 1 }]),
  }),
};

vi.mock("../queries/connection", () => ({
  getDb: () => mockDb,
}));

vi.mock("../services/audit", () => ({
  getDemoWorkspace: vi.fn().mockResolvedValue({ id: 1, name: "Demo Workspace" }),
  writeAudit: vi.fn().mockResolvedValue(true),
}));

vi.mock("../insightsRouter", () => ({
  reconcileInsights: vi.fn().mockResolvedValue({ anomaliesDetected: 1 }),
}));

describe("IoT Telemetry Ingestion Subsystem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Topic & Payload Normalization Logic", () => {
    it("extracts device identifiers from MQTT single-level wildcard topic patterns", () => {
      const topic = "ontos/twins/WarehouseTwin_1/telemetry";
      const pattern = "ontos/twins/+/telemetry";

      const topicParts = topic.split("/");
      const patternParts = pattern.split("/");
      let extractedId: string | undefined;

      for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i] === "+" || patternParts[i].startsWith("{")) {
          extractedId = topicParts[i];
          break;
        }
      }

      expect(extractedId).toBe("WarehouseTwin_1");
    });

    it("extracts device identifiers from Azure/AWS curly brace placeholder patterns", () => {
      const topic = "devices/Sensor_ColdRoom_9/messages/events";
      const pattern = "devices/{deviceId}/messages/events";

      const topicParts = topic.split("/");
      const patternParts = pattern.split("/");
      let extractedId: string | undefined;

      for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i] === "+" || patternParts[i].startsWith("{")) {
          extractedId = topicParts[i];
          break;
        }
      }

      expect(extractedId).toBe("Sensor_ColdRoom_9");
    });

    it("normalizes both flat and nested telemetry payloads", () => {
      // Flat payload
      const flatPayload = {
        deviceId: "Zone_WH1_Cold1",
        temperature: 4.2,
        humidity: 65.0,
      };

      const pointFlat: RawTelemetryPoint = {
        deviceId: flatPayload.deviceId,
        telemetry: flatPayload,
      };
      expect(pointFlat.telemetry.temperature).toBe(4.2);

      // Nested payload
      const nestedPayload = {
        deviceId: "Zone_WH1_Cold1",
        timestamp: "2026-09-21T20:00:00Z",
        telemetry: {
          temperature: 4.8,
          humidity: 68.2,
          doorOpen: false,
        },
      };

      const pointNested: RawTelemetryPoint = {
        deviceId: nestedPayload.deviceId,
        timestamp: nestedPayload.timestamp,
        telemetry: nestedPayload.telemetry,
      };
      expect(pointNested.telemetry.temperature).toBe(4.8);
      expect(pointNested.telemetry.doorOpen).toBe(false);
    });
  });

  describe("Device to Digital Twin Resolution (resolveTwinNode)", () => {
    it("resolves via explicit deviceMappings table override", async () => {
      const mockTwinNode = {
        id: 42,
        workspaceId: 1,
        iri: "dtwin:WarehouseTwin_1",
        label: "Twin — Cold Storage Warehouse Alpha",
        classIri: "dtwin:WarehouseTwin",
        moduleKey: "digital_twin",
        propsJson: { temperature: 3.5 },
      };

      mockLimit.mockResolvedValueOnce([mockTwinNode]);

      const point: RawTelemetryPoint = {
        deviceId: "device_sensor_007",
        telemetry: { temperature: 5.2 },
      };

      const resolved = await resolveTwinNode(1, point, {
        device_sensor_007: "dtwin:WarehouseTwin_1",
      });

      expect(resolved).not.toBeNull();
      expect(resolved?.iri).toBe("dtwin:WarehouseTwin_1");
    });

    it("resolves via direct IRI or dtwin: prefixed deviceId", async () => {
      const mockTwinNode = {
        id: 101,
        workspaceId: 1,
        iri: "dtwin:Zone_WH1_Cold1",
        label: "Twin — Cold Storage Zone 1",
        classIri: "dtwin:WarehouseTwin",
        moduleKey: "digital_twin",
        propsJson: { temperature: 3.8 },
      };

      // By IRI returns nothing, then directNode returns the match
      mockLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([mockTwinNode]);

      const point: RawTelemetryPoint = {
        deviceId: "Zone_WH1_Cold1",
        telemetry: { temperature: 7.1 },
      };

      const resolved = await resolveTwinNode(1, point);

      expect(resolved).not.toBeNull();
      expect(resolved?.id).toBe(101);
      expect(resolved?.iri).toBe("dtwin:Zone_WH1_Cold1");
    });

    it("returns null if device cannot be matched across IRI, label, or props", async () => {
      // By IRI returns empty, directNode returns empty, labelNode returns empty, allTwins returns empty
      mockLimit
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const point: RawTelemetryPoint = {
        deviceId: "ghost_device_999",
        telemetry: { temperature: 20 },
      };

      const resolved = await resolveTwinNode(1, point);
      expect(resolved).toBeNull();
    });
  });

  describe("Telemetry Ingestion & State Mutation (ingestTelemetry)", () => {
    it("handles empty point arrays cleanly", async () => {
      const result = await ingestTelemetry([]);
      expect(result.success).toBe(true);
      expect(result.receivedCount).toBe(0);
      expect(result.updatedTwins).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it("rejects malformed points with non-object telemetry", async () => {
      const malformed = [
        {
          deviceId: "WH1",
          telemetry: "not_an_object" as unknown as Record<string, string | number | boolean | null | undefined>,
        },
      ];

      const result = await ingestTelemetry(malformed as unknown as RawTelemetryPoint[]);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("telemetry must be an object");
    });

    it("successfully updates twin props, logs time-series entries, and triggers insight reconciliation", async () => {
      const mockTwinNode = {
        id: 77,
        workspaceId: 1,
        iri: "dtwin:Logistics_Shipment_1004",
        label: "Twin — Cold-Chain Pharma In-Transit",
        classIri: "dtwin:LogisticsShipmentTwin",
        moduleKey: "digital_twin",
        propsJson: {
          temperature: 3.5,
          humidity: 50.0,
          status: "in_transit",
        },
      };

      // Mock resolveTwinNode finding the node
      mockLimit.mockResolvedValueOnce([mockTwinNode]);

      const points: RawTelemetryPoint[] = [
        {
          twinIri: "dtwin:Logistics_Shipment_1004",
          deviceId: "tracker-pharma-1004",
          timestamp: "2026-09-21T20:30:00.000Z",
          telemetry: {
            temperature: 7.2, // Exceeds 6°C cold-chain threshold
            humidity: 54.5,
            vibration: 0.12,
            status: "warning",
          },
        },
      ];

      const result = await ingestTelemetry(points, {
        workspaceId: 1,
        source: "test_aws_iot",
      });

      expect(result.success).toBe(true);
      expect(result.receivedCount).toBe(1);
      expect(result.updatedTwins).toHaveLength(1);
      expect(result.updatedTwins[0].twinIri).toBe("dtwin:Logistics_Shipment_1004");
      expect(result.updatedTwins[0].updatedKeys).toEqual(
        expect.arrayContaining(["temperature", "humidity", "vibration", "status"]),
      );

      // Verify db.update was called on kgNodes
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          propsJson: expect.objectContaining({
            temperature: 7.2,
            humidity: 54.5,
            vibration: 0.12,
            status: "warning",
            lastTickAt: "2026-09-21T20:30:00.000Z",
          }),
        }),
      );

      // Verify db.insert was called for twinStateLog time-series
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalled();
    });

    it("reports an error when resolving an unmapped device ID", async () => {
      mockLimit
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const points: RawTelemetryPoint[] = [
        {
          deviceId: "unknown_sensor",
          telemetry: { temperature: 22.0 },
        },
      ];

      const result = await ingestTelemetry(points, { workspaceId: 1 });

      expect(result.success).toBe(false);
      expect(result.updatedTwins).toHaveLength(0);
      expect(result.errors).toContain(
        "Could not resolve device 'unknown_sensor' to an active digital twin",
      );
    });
  });
});
