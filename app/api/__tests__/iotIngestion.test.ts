import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EventEmitter } from "node:events";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { KgNode } from "@db/schema";
import type { RawTelemetryPoint } from "../services/iot/types";
import {
  ingestTelemetry,
  resolveTwinNode,
  webhookWorkspaceId,
} from "../services/iot/iotIngestion";
import { MqttBrokerAdapter } from "../services/iot/mqttAdapter";
import { getDemoWorkspace, writeAudit } from "../services/audit";
import { reconcileInsights, runRules } from "../insightsRouter";

const DEMO_WS_ID = 9;

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

vi.mock("../services/audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/audit")>()),
  getDemoWorkspace: vi.fn().mockResolvedValue({ id: 9, name: "Demo Workspace" }),
  writeAudit: vi.fn().mockResolvedValue(true),
}));

// reconcileInsights is replaced (it reads the DB); runRules stays real so the
// threshold tests evaluate persisted twin state with the production rule engine.
vi.mock("../insightsRouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../insightsRouter")>()),
  reconcileInsights: vi.fn().mockResolvedValue({ scanned: { nodes: 0, edges: 0 }, results: [] }),
}));

// The real ingestTelemetry, wrapped in a spy so MQTT routing into it is observable.
vi.mock("../services/iot/iotIngestion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/iot/iotIngestion")>();
  return { ...actual, ingestTelemetry: vi.fn(actual.ingestTelemetry) };
});

// A fake MQTT client: the adapter's real handlers are attached to it and the
// tests drive them by emitting broker events.
const mqttState = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("mqtt", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  return {
    default: {
      connect: vi.fn(() => {
        const client = Object.assign(new Emitter(), {
          connected: false,
          subscribe: vi.fn((_topic: string, cb?: (err: Error | null) => void) => cb?.(null)),
          end: vi.fn((_force: boolean, cb?: () => void) => cb?.()),
        });
        mqttState.client = client;
        return client;
      }),
    },
  };
});

type FakeMqttClient = EventEmitter & { connected: boolean; subscribe: ReturnType<typeof vi.fn> };
type PropsWrite = { propsJson: Record<string, unknown> };
type LogRow = { nodeId: number; key: string; valueNum: number | null; valueText: string | null; unit: string | null; recordedAt: Date };

const dialect = new MySqlDialect();
const renderWhere = (i: number) => dialect.sqlToQuery(mockWhere.mock.calls[i][0] as SQL);
const lastPropsWrite = () => (mockSet.mock.calls.at(-1)![0] as PropsWrite).propsJson;
const loggedRows = () => mockValues.mock.calls.flatMap((c) => c[0] as LogRow[]);

const coldZone = {
  id: 55,
  workspaceId: 1,
  iri: "dtwin:log/warehouse-01/zone-cold-chain",
  label: "Twin · WH-01 cold-chain zone",
  classIri: "dtwin:ZoneTwin",
  moduleKey: "twin",
  propsJson: { zoneType: "cold-chain", temperature: 4.1, humidity: 50 } as Record<string, unknown>,
  sourceMappingId: null,
  deletedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockLimit.mockReset();
  mockLimit.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("IoT Telemetry Ingestion Subsystem", () => {
  describe("MQTT topic parsing & payload normalisation (MqttBrokerAdapter)", () => {
    async function connectAdapter(topicPattern?: string) {
      const adapter = new MqttBrokerAdapter({
        workspaceId: 7,
        name: "plant-a",
        brokerType: "mqtt",
        endpointUrl: "mqtt://broker.test:1883",
        authType: "none",
        topicPattern,
        deviceMappings: { "tracker-1": "dtwin:log/shipment-1" },
      });
      const connecting = adapter.connect();
      const client = mqttState.client as FakeMqttClient;
      client.connected = true;
      client.emit("connect");
      await expect(connecting).resolves.toBe(true);
      return { adapter, client };
    }

    async function publish(client: FakeMqttClient, topic: string, payload: unknown) {
      const before = vi.mocked(ingestTelemetry).mock.calls.length;
      client.emit("message", topic, Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload)));
      await vi.waitFor(() => expect(vi.mocked(ingestTelemetry).mock.calls.length).toBe(before + 1));
      return vi.mocked(ingestTelemetry).mock.calls.at(-1)!;
    }

    it("subscribes to the default '+' pattern and takes the device id from that topic segment", async () => {
      const { client } = await connectAdapter();
      expect(client.subscribe).toHaveBeenCalledWith("ontos/twins/+/telemetry", expect.any(Function));

      const [points, options] = await publish(client, "ontos/twins/WarehouseTwin_1/telemetry", {
        temperature: 4.2,
        humidity: 65,
      });

      expect(points).toEqual([
        { twinIri: undefined, deviceId: "WarehouseTwin_1", timestamp: undefined, telemetry: { temperature: 4.2, humidity: 65 } },
      ]);
      expect(options).toEqual({
        workspaceId: 7,
        source: "mqtt:plant-a",
        deviceMappings: { "tracker-1": "dtwin:log/shipment-1" },
      });
    });

    it("extracts the device id from an Azure/AWS style {deviceId} placeholder pattern", async () => {
      const { client } = await connectAdapter("devices/{deviceId}/messages/events");
      expect(client.subscribe).toHaveBeenCalledWith("devices/{deviceId}/messages/events", expect.any(Function));

      const [points] = await publish(client, "devices/Sensor_ColdRoom_9/messages/events", { temperature: 3.9 });

      expect(points).toHaveLength(1);
      expect(points[0].deviceId).toBe("Sensor_ColdRoom_9");
      expect(points[0].telemetry).toEqual({ temperature: 3.9 });
    });

    it("unwraps a nested telemetry object and prefers the payload's own deviceId/timestamp over the topic", async () => {
      const { client } = await connectAdapter();

      const [points] = await publish(client, "ontos/twins/topic-device/telemetry", {
        deviceId: "Zone_WH1_Cold1",
        timestamp: "2026-09-21T20:00:00Z",
        telemetry: { temperature: 4.8, humidity: 68.2, doorOpen: false },
      });

      expect(points).toEqual([
        {
          twinIri: undefined,
          deviceId: "Zone_WH1_Cold1",
          timestamp: "2026-09-21T20:00:00Z",
          telemetry: { temperature: 4.8, humidity: 68.2, doorOpen: false },
        },
      ]);
    });

    it("turns an array payload into one point per element, falling back to the topic device id", async () => {
      const { client } = await connectAdapter();

      const [points] = await publish(client, "ontos/twins/Gateway_3/telemetry", [
        { temperature: 5.1 },
        { twinIri: "dtwin:log/shipment-2", telemetry: { etaMinutes: 40 } },
      ]);

      expect(points).toEqual([
        { twinIri: undefined, deviceId: "Gateway_3", timestamp: undefined, telemetry: { temperature: 5.1 } },
        { twinIri: "dtwin:log/shipment-2", deviceId: "Gateway_3", timestamp: undefined, telemetry: { etaMinutes: 40 } },
      ]);
    });

    it("counts a malformed JSON message as an error without calling ingestion", async () => {
      const { adapter, client } = await connectAdapter();

      client.emit("message", "ontos/twins/X/telemetry", Buffer.from("{not json"));

      await vi.waitFor(() => expect(adapter.stats.errorCount).toBe(1));
      expect(adapter.stats.messageCount).toBe(1);
      expect(adapter.stats.lastError).toMatch(/^Message processing error:/);
      expect(ingestTelemetry).not.toHaveBeenCalled();
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
      // the lookup used the mapped IRI, inside the workspace and twin module
      const { sql, params } = renderWhere(0);
      expect(sql).toContain("`kg_nodes`.`workspaceId` = ?");
      expect(sql).toContain("`kg_nodes`.`iri` = ?");
      expect(params).toEqual([1, "twin", "dtwin:WarehouseTwin_1"]);
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

      // No twinIri/mapping, so the first lookup is the direct-IRI candidate query
      mockLimit.mockResolvedValueOnce([mockTwinNode]);

      const point: RawTelemetryPoint = {
        deviceId: "Zone_WH1_Cold1",
        telemetry: { temperature: 7.1 },
      };

      const resolved = await resolveTwinNode(1, point);

      expect(resolved).not.toBeNull();
      expect(resolved?.id).toBe(101);
      expect(resolved?.iri).toBe("dtwin:Zone_WH1_Cold1");
      const { params } = renderWhere(0);
      expect(params).toEqual([1, "twin", "Zone_WH1_Cold1", "dtwin:Zone_WH1_Cold1", "dtwin:Zone_WH1_Cold1"]);
    });

    it("returns null if device cannot be matched across IRI, label, or props", async () => {
      const point: RawTelemetryPoint = {
        deviceId: "ghost_device_999",
        telemetry: { temperature: 20 },
      };

      const resolved = await resolveTwinNode(1, point);
      expect(resolved).toBeNull();
      // direct IRI, label, and full-scan lookups were all attempted
      expect(mockLimit).toHaveBeenCalledTimes(3);
    });
  });

  describe("Webhook workspace binding (webhookWorkspaceId)", () => {
    it("uses IOT_WORKSPACE_ID when it is a positive integer", async () => {
      vi.stubEnv("IOT_WORKSPACE_ID", "42");
      await expect(webhookWorkspaceId()).resolves.toBe(42);
      expect(getDemoWorkspace).not.toHaveBeenCalled();
    });

    it("falls back to the demo workspace when IOT_WORKSPACE_ID is unset", async () => {
      vi.stubEnv("IOT_WORKSPACE_ID", undefined);
      await expect(webhookWorkspaceId()).resolves.toBe(DEMO_WS_ID);
      expect(getDemoWorkspace).toHaveBeenCalledOnce();
    });

    it.each(["", "abc", "0", "-3", "2.5"])("falls back to the demo workspace for invalid IOT_WORKSPACE_ID %j", async (raw) => {
      vi.stubEnv("IOT_WORKSPACE_ID", raw);
      await expect(webhookWorkspaceId()).resolves.toBe(DEMO_WS_ID);
    });
  });

  describe("Telemetry Ingestion & State Mutation (ingestTelemetry)", () => {
    it("handles empty point arrays cleanly", async () => {
      const result = await ingestTelemetry([]);
      expect(result.success).toBe(true);
      expect(result.receivedCount).toBe(0);
      expect(result.updatedTwins).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(reconcileInsights).not.toHaveBeenCalled();
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
      expect(mockSelect).not.toHaveBeenCalled();
      expect(reconcileInsights).not.toHaveBeenCalled();
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

      // Only logged numeric keys (not 'vibration') and status reach twin_state_log, with DTDL units
      const at = new Date("2026-09-21T20:30:00.000Z");
      expect(loggedRows()).toEqual([
        { nodeId: 77, key: "temperature", valueNum: 7.2, valueText: null, unit: "degreeCelsius", recordedAt: at },
        { nodeId: 77, key: "humidity", valueNum: 54.5, valueText: null, unit: "percent", recordedAt: at },
        { nodeId: 77, key: "status", valueNum: null, valueText: "warning", unit: null, recordedAt: at },
      ]);

      expect(reconcileInsights).toHaveBeenCalledOnce();
      expect(reconcileInsights).toHaveBeenCalledWith(1);
      expect(writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 1, actor: "test_aws_iot", entityType: "iot_telemetry" }),
      );
    });

    it("reports an error when resolving an unmapped device ID", async () => {
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
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(reconcileInsights).not.toHaveBeenCalled();
      expect(writeAudit).not.toHaveBeenCalled();
    });

    it("skips null, undefined and non-scalar values, stores booleans as strings, and only reconciles when something changed", async () => {
      mockLimit.mockResolvedValueOnce([coldZone]);
      const onlyEmpty = await ingestTelemetry(
        [{ twinIri: coldZone.iri, telemetry: { temperature: null, humidity: undefined, nested: { a: 1 } as never } }],
        { workspaceId: 1 },
      );
      expect(onlyEmpty.success).toBe(true);
      expect(onlyEmpty.updatedTwins).toEqual([]);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(reconcileInsights).not.toHaveBeenCalled();

      mockLimit.mockResolvedValueOnce([coldZone]);
      const withFlag = await ingestTelemetry(
        [{ twinIri: coldZone.iri, telemetry: { doorOpen: true, nested: [1, 2] as never } }],
        { workspaceId: 1 },
      );
      expect(withFlag.updatedTwins[0].updatedKeys).toEqual(["doorOpen"]);
      expect(lastPropsWrite()).toMatchObject({ doorOpen: "true", zoneType: "cold-chain", temperature: 4.1 });
      expect(lastPropsWrite()).not.toHaveProperty("nested");
      expect(loggedRows()).toEqual([]);
      expect(reconcileInsights).toHaveBeenCalledOnce();
    });

    it("reconciles insights for the caller's workspace, once per batch", async () => {
      mockLimit.mockResolvedValueOnce([coldZone]).mockResolvedValueOnce([coldZone]);
      await ingestTelemetry(
        [
          { twinIri: coldZone.iri, telemetry: { temperature: 4.4 } },
          { twinIri: coldZone.iri, telemetry: { humidity: 51 } },
        ],
        { workspaceId: 42 },
      );
      expect(reconcileInsights).toHaveBeenCalledOnce();
      expect(reconcileInsights).toHaveBeenCalledWith(42);
      expect(getDemoWorkspace).not.toHaveBeenCalled();
    });

    it("treats a reconciliation failure as non-fatal and still writes the audit entry", async () => {
      vi.mocked(reconcileInsights).mockRejectedValueOnce(new Error("insights table locked"));
      mockLimit.mockResolvedValueOnce([coldZone]);

      const result = await ingestTelemetry([{ twinIri: coldZone.iri, telemetry: { temperature: 4.4 } }], {
        workspaceId: 1,
      });

      expect(result.success).toBe(true);
      expect(reconcileInsights).toHaveBeenCalledWith(1);
      expect(writeAudit).toHaveBeenCalledOnce();
    });

    it("outside production, a call without workspaceId falls back to the demo workspace", async () => {
      mockLimit.mockResolvedValueOnce([coldZone]);

      const result = await ingestTelemetry([{ twinIri: coldZone.iri, telemetry: { temperature: 4.4 } }]);

      expect(result.success).toBe(true);
      expect(getDemoWorkspace).toHaveBeenCalledOnce();
      expect(renderWhere(0).params[0]).toBe(DEMO_WS_ID);
      expect(reconcileInsights).toHaveBeenCalledWith(DEMO_WS_ID);
    });

    it("in production, a call without workspaceId is refused before touching the database", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("APP_SECRET", "test-secret-test-secret-test-secret");
      vi.stubEnv("DATABASE_URL", "mysql://test:test@localhost:3306/test");
      vi.resetModules();
      // re-evaluate the real module (and lib/env) under the production env
      const fresh = await vi.importActual<typeof import("../services/iot/iotIngestion")>(
        "../services/iot/iotIngestion",
      );
      const freshAudit = await import("../services/audit"); // the instance `fresh` is bound to

      const result = await fresh.ingestTelemetry([{ twinIri: coldZone.iri, telemetry: { temperature: 4.4 } }]);

      expect(result.success).toBe(false);
      expect(result.errors).toEqual([
        "Refused: Multi-tenant telemetry ingestion requires an authorized workspaceId.",
      ]);
      expect(freshAudit.getDemoWorkspace).not.toHaveBeenCalled();
      expect(mockSelect).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe("Timestamps", () => {
    const NOW = new Date("2026-09-23T12:00:00.000Z");

    it("records an ISO timestamp verbatim as recordedAt and lastTickAt", async () => {
      mockLimit.mockResolvedValueOnce([coldZone]);
      await ingestTelemetry(
        [{ twinIri: coldZone.iri, timestamp: "2026-09-22T08:15:00.000Z", telemetry: { temperature: 4.4 } }],
        { workspaceId: 1 },
      );
      expect(lastPropsWrite().lastTickAt).toBe("2026-09-22T08:15:00.000Z");
      expect(loggedRows()[0].recordedAt).toEqual(new Date("2026-09-22T08:15:00.000Z"));
    });

    it("accepts epoch-millisecond timestamps", async () => {
      const epoch = Date.parse("2026-09-22T09:00:00.000Z");
      mockLimit.mockResolvedValueOnce([coldZone]);
      await ingestTelemetry([{ twinIri: coldZone.iri, timestamp: epoch, telemetry: { temperature: 4.4 } }], {
        workspaceId: 1,
      });
      expect(lastPropsWrite().lastTickAt).toBe("2026-09-22T09:00:00.000Z");
      expect(loggedRows()[0].recordedAt).toEqual(new Date(epoch));
    });

    it.each([
      ["an unparseable string", "not-a-date"],
      ["an empty string", ""],
      ["NaN", Number.NaN],
    ])("falls back to the ingest time for %s", async (_label, timestamp) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      mockLimit.mockResolvedValueOnce([coldZone]);

      await ingestTelemetry([{ twinIri: coldZone.iri, timestamp, telemetry: { temperature: 4.4 } }], {
        workspaceId: 1,
      });

      expect(lastPropsWrite().lastTickAt).toBe(NOW.toISOString());
      expect(loggedRows()[0].recordedAt).toEqual(NOW);
    });

    // BUG iotIngestion.ts:187-231 — no ordering check: a late reading (older than the twin's lastTickAt) overwrites live state and rewinds lastTickAt.
    it.skip("does not let a reading older than the twin's lastTickAt overwrite its current state", async () => {
      const live = { ...coldZone, propsJson: { ...coldZone.propsJson, temperature: 4.0, lastTickAt: "2026-09-21T20:00:00.000Z" } };
      mockLimit.mockResolvedValueOnce([live]);

      await ingestTelemetry(
        [{ twinIri: live.iri, timestamp: "2026-09-20T08:00:00.000Z", telemetry: { temperature: 9.5 } }],
        { workspaceId: 1 },
      );

      for (const [write] of mockSet.mock.calls as [PropsWrite][]) {
        expect(write.propsJson.temperature).toBe(4.0);
        expect(write.propsJson.lastTickAt).toBe("2026-09-21T20:00:00.000Z");
      }
    });
  });

  describe("Value bounds", () => {
    it("persists extreme readings unclamped so excursions stay visible", async () => {
      mockLimit.mockResolvedValueOnce([coldZone]);
      await ingestTelemetry([{ twinIri: coldZone.iri, telemetry: { temperature: -40, humidity: 0 } }], {
        workspaceId: 1,
      });
      expect(lastPropsWrite()).toMatchObject({ temperature: -40, humidity: 0 });
      expect(loggedRows().map((r) => [r.key, r.valueNum])).toEqual([
        ["temperature", -40],
        ["humidity", 0],
      ]);
    });

    // BUG iotIngestion.ts:199-210 — non-finite numbers (webhook/MQTT JSON `1e400` parses to Infinity) reach propsJson and the twin_state_log insert.
    it.skip("does not persist non-finite numeric telemetry", async () => {
      const points = JSON.parse(
        `[{"twinIri":"${coldZone.iri}","telemetry":{"temperature":1e400,"humidity":55}}]`,
      ) as RawTelemetryPoint[];
      mockLimit.mockResolvedValueOnce([coldZone]);

      await ingestTelemetry(points, { workspaceId: 1 });

      for (const row of loggedRows()) {
        if (row.valueNum !== null) expect(Number.isFinite(row.valueNum), row.key).toBe(true);
      }
      for (const [write] of mockSet.mock.calls as [PropsWrite][]) {
        for (const [k, v] of Object.entries(write.propsJson)) {
          if (typeof v === "number") expect(Number.isFinite(v), k).toBe(true);
        }
      }
    });
  });

  describe("Cold-chain threshold alerts (ingested state evaluated by the real rule engine)", () => {
    async function ingestAndScan(twin: typeof coldZone, temperature: number) {
      mockLimit.mockResolvedValueOnce([twin]);
      const result = await ingestTelemetry([{ twinIri: twin.iri, telemetry: { temperature } }], {
        workspaceId: 1,
      });
      expect(result.success).toBe(true);
      expect(reconcileInsights).toHaveBeenCalledWith(1);
      const persisted = { ...twin, propsJson: lastPropsWrite() } as unknown as KgNode;
      return runRules([persisted], []).filter((f) => f.ruleId === "twin-cold-chain-excursion");
    }

    it.each([
      [7.2, true],
      [6.1, true],
      [1.9, true],
      [-40, true],
      [6.0, false],
      [2.0, false],
      [4.4, false],
    ])("a cold-chain zone reading of %s°C raises an excursion: %s", async (temperature, alerts) => {
      const hits = await ingestAndScan(coldZone, temperature);
      if (alerts) {
        expect(hits).toHaveLength(1);
        expect(hits[0].severity).toBe("risk");
        expect(hits[0].evidence.nodeIds).toEqual([coldZone.id]);
        expect(hits[0].summary).toContain(`(${temperature}°C)`);
      } else {
        expect(hits).toEqual([]);
      }
    });

    it("an ambient storage zone at 9°C raises no cold-chain alert", async () => {
      const storage = { ...coldZone, id: 56, iri: "dtwin:log/warehouse-01/zone-storage", propsJson: { zoneType: "storage", temperature: 18 } };
      expect(await ingestAndScan(storage, 9)).toEqual([]);
    });
  });
});
