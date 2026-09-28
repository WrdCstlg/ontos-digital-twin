import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { KgNode } from "@db/schema";
import type { RawTelemetryPoint } from "../services/iot/types";
import {
  brokerMessagePoints,
  ingestBrokerMessage,
  ingestTelemetry,
  messageFingerprint,
  readBrokerMessage,
  reconcileInsightsSoon,
  resolveTwinNode,
  webhookWorkspaceId,
} from "../services/iot/iotIngestion";
import { getDemoWorkspace, writeAudit } from "../services/audit";
import { reconcileInsights, runRules } from "../insightsRouter";
import { recordGraphChange } from "../services/graphChanges";

const DEMO_WS_ID = 9;

// Mock the database and external services. Reads that resolve a device end in
// limit(); the transaction's locking read of the twins in orderBy().for(), and
// its check of the lease in for() alone. Every write is recorded, in order.
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockLocked = vi.fn();
const mockFence = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const writes: string[] = [];

const mockDb = {
  select: mockSelect.mockReturnValue({
    from: mockFrom.mockReturnValue({
      where: mockWhere.mockReturnValue({
        limit: mockLimit,
        orderBy: () => ({ for: mockLocked }),
        for: mockFence,
      }),
    }),
  }),
  update: mockUpdate.mockImplementation((t: Table) => ({
    set: mockSet.mockImplementation(() => ({
      where: vi.fn(async () => {
        writes.push(`update ${getTableName(t)}`);
        return [{ affectedRows: 1 }];
      }),
    })),
  })),
  insert: mockInsert.mockImplementation((t: Table) => ({
    values: mockValues.mockImplementation(async () => {
      writes.push(`insert ${getTableName(t)}`);
      return [{ insertId: 1 }];
    }),
  })),
  // A transaction on the same mock: what one guarantees is tested on a real MySQL.
  transaction: vi.fn(async (body: (tx: unknown) => Promise<unknown>, config?: unknown) => {
    writes.push(`begin ${JSON.stringify(config ?? {})}`);
    const result = await body(mockDb);
    writes.push("commit");
    return result;
  }),
};

vi.mock("../queries/connection", () => ({
  getDb: () => mockDb,
}));

vi.mock("../services/graphChanges", () => ({ recordGraphChange: vi.fn(async () => 1) }));

vi.mock("../services/audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/audit")>()),
  getDemoWorkspace: vi.fn().mockResolvedValue({ id: 9, name: "Demo Workspace" }),
  writeAudit: vi.fn(async () => {
    writes.push("audit");
    return true;
  }),
}));

// reconcileInsights is replaced (it reads the DB); runRules stays real so the
// threshold tests evaluate persisted twin state with the production rule engine.
vi.mock("../insightsRouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../insightsRouter")>()),
  reconcileInsights: vi.fn().mockResolvedValue({ scanned: { nodes: 0, edges: 0 }, results: [] }),
}));

type PropsWrite = { propsJson: Record<string, unknown> };
type LogRow = { nodeId: number; key: string; valueNum: number | null; valueText: string | null; unit: string | null; recordedAt: Date };

const dialect = new MySqlDialect();
const renderWhere = (i: number) => dialect.sqlToQuery(mockWhere.mock.calls[i][0] as SQL);
const lastPropsWrite = () => (mockSet.mock.calls.at(-1)![0] as PropsWrite).propsJson;
const loggedRows = () => mockValues.mock.calls.filter((c) => Array.isArray(c[0])).flatMap((c) => c[0] as LogRow[]);

/** The twins the device lookups found, as the locking read then returns them: current, in id order. */
async function resolvedTwins() {
  const found = (await Promise.all(mockLimit.mock.results.map((r) => r.value))) as KgNode[][];
  const byId = new Map(found.flat().map((t) => [t.id, t]));
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

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
  writes.length = 0;
  mockLimit.mockReset();
  mockLimit.mockResolvedValue([]);
  mockLocked.mockReset();
  mockLocked.mockImplementation(resolvedTwins);
  mockFence.mockReset();
  mockFence.mockResolvedValue([{ name: "iot-consumer" }]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("IoT Telemetry Ingestion Subsystem", () => {
  describe("reading a broker message (readBrokerMessage)", () => {
    const read = (topic: string, payload: unknown, pattern = "ontos/twins/+/telemetry") =>
      readBrokerMessage(topic, Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload)), pattern);

    it("takes the device id from the '+' segment of the topic", () => {
      expect(read("ontos/twins/WarehouseTwin_1/telemetry", { temperature: 4.2, humidity: 65 }).points).toEqual([
        { twinIri: undefined, deviceId: "WarehouseTwin_1", timestamp: undefined, telemetry: { temperature: 4.2, humidity: 65 } },
      ]);
    });

    it("extracts the device id from an Azure/AWS style {deviceId} placeholder pattern", () => {
      const { points } = read("devices/Sensor_ColdRoom_9/messages/events", { temperature: 3.9 }, "devices/{deviceId}/messages/events");
      expect(points).toHaveLength(1);
      expect(points[0].deviceId).toBe("Sensor_ColdRoom_9");
      expect(points[0].telemetry).toEqual({ temperature: 3.9 });
    });

    it("unwraps a nested telemetry object and prefers the payload's own deviceId/timestamp over the topic", () => {
      expect(
        read("ontos/twins/topic-device/telemetry", {
          deviceId: "Zone_WH1_Cold1",
          timestamp: "2026-09-21T20:00:00Z",
          telemetry: { temperature: 4.8, humidity: 68.2, doorOpen: false },
        }).points,
      ).toEqual([
        {
          twinIri: undefined,
          deviceId: "Zone_WH1_Cold1",
          timestamp: "2026-09-21T20:00:00Z",
          telemetry: { temperature: 4.8, humidity: 68.2, doorOpen: false },
        },
      ]);
    });

    it("turns an array payload into one point per element, falling back to the topic device id", () => {
      expect(
        read("ontos/twins/Gateway_3/telemetry", [{ temperature: 5.1 }, { twinIri: "dtwin:log/shipment-2", telemetry: { etaMinutes: 40 } }]).points,
      ).toEqual([
        { twinIri: undefined, deviceId: "Gateway_3", timestamp: undefined, telemetry: { temperature: 5.1 } },
        { twinIri: "dtwin:log/shipment-2", deviceId: "Gateway_3", timestamp: undefined, telemetry: { etaMinutes: 40 } },
      ]);
    });

    it("keeps a top-level message id out of the readings", () => {
      expect(read("ontos/twins/T1/telemetry", { messageId: "m-1", msgId: 7, temperature: 4 }).points[0].telemetry).toEqual({ temperature: 4 });
    });

    it("gives a payload that is not an object no points, and refuses one that is not JSON or is too large", () => {
      expect(read("ontos/twins/T1/telemetry", 42).points).toEqual([]);
      expect(brokerMessagePoints(null)).toEqual([]);
      expect(() => read("ontos/twins/X/telemetry", "{not json")).toThrow(SyntaxError);
      expect(() => readBrokerMessage("t", Buffer.alloc(2 * 1024 * 1024 + 1, 32), "t")).toThrow(/more than the 2097152 accepted/);
    });
  });

  describe("what recognises a message delivered again (messageFingerprint)", () => {
    const payload = (o: unknown) => Buffer.from(JSON.stringify(o));

    it("is the same for the same bytes on the same topic, and differs by topic or by a byte", () => {
      const a = messageFingerprint("ontos/twins/T1/telemetry", payload({ temperature: 4, timestamp: 1 }));
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      expect(messageFingerprint("ontos/twins/T1/telemetry", payload({ temperature: 4, timestamp: 1 }))).toBe(a);
      expect(messageFingerprint("ontos/twins/T2/telemetry", payload({ temperature: 4, timestamp: 1 }))).not.toBe(a);
      expect(messageFingerprint("ontos/twins/T1/telemetry", payload({ temperature: 4, timestamp: 2 }))).not.toBe(a);
    });

    it("follows the payload's own message id when it has one, whatever else the payload holds", () => {
      const first = { messageId: "m-7", temperature: 4, sentAt: "10:00" };
      const resent = { messageId: "m-7", temperature: 4, sentAt: "10:05" };
      const id = (o: Record<string, unknown>, topic = "ontos/twins/T1/telemetry") => messageFingerprint(topic, payload(o), o);
      expect(id(resent)).toBe(id(first));
      expect(id({ msgId: 7 })).toBe(id({ msgId: "7" }));
      expect(id({ messageId: "m-8", temperature: 4, sentAt: "10:00" })).not.toBe(id(first));
      // A device's own counter is not unique across devices: the topic still counts.
      expect(id(first, "ontos/twins/T2/telemetry")).not.toBe(id(first));
      // An array's elements carry no id for the whole message.
      const arr = [{ messageId: "m-7" }];
      expect(messageFingerprint("t", payload(arr), arr)).toBe(messageFingerprint("t", payload(arr)));
    });

    it("comes out the same from reading the message", () => {
      const o = { messageId: "m-9", temperature: 4 };
      expect(readBrokerMessage("t/T1", payload(o), "t/+").fingerprint).toBe(messageFingerprint("t/T1", payload(o), o));
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
      expect(mockDb.transaction).not.toHaveBeenCalled();
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
      // The twin's new state is a change to the workspace's graph, recorded with it.
      expect(vi.mocked(recordGraphChange)).toHaveBeenLastCalledWith(mockDb, 1, { nodes: [77] });
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
        mockDb,
      );
    });

    it("writes in one transaction, with the twin locked before its state is read, and the audit entry inside it", async () => {
      mockLimit.mockResolvedValueOnce([coldZone]);
      await ingestTelemetry([{ twinIri: coldZone.iri, telemetry: { temperature: 4.4 } }], { workspaceId: 1 });

      expect(writes).toEqual([`begin {"isolationLevel":"read committed"}`, "update kg_nodes", "insert twin_state_log", "audit", "commit"]);
      // The locking read: this workspace's live twins, by id.
      expect(mockLocked).toHaveBeenCalledWith("update");
      const lock = renderWhere(mockWhere.mock.calls.length - 1);
      expect(lock.sql).toMatch(/`kg_nodes`\.`id` in \(\?\) and `kg_nodes`\.`workspaceId` = \? and `kg_nodes`\.`deletedAt` is null/);
      expect(lock.params).toEqual([55, 1]);
      // Insights are reconciled after the commit, outside the transaction.
      expect(reconcileInsights).toHaveBeenCalledOnce();
    });

    it("merges the state it read under the lock, not the one the lookup saw: a reading written meanwhile is kept", async () => {
      mockLimit.mockResolvedValueOnce([coldZone]);
      // Between the lookup and the lock, another writer set humidity.
      mockLocked.mockResolvedValueOnce([{ ...coldZone, propsJson: { ...coldZone.propsJson, humidity: 61 } }]);
      await ingestTelemetry([{ twinIri: coldZone.iri, telemetry: { temperature: 4.4 } }], { workspaceId: 1 });
      expect(lastPropsWrite()).toMatchObject({ temperature: 4.4, humidity: 61, zoneType: "cold-chain" });
    });

    it("locks the twins of a batch once each, in id order, and writes each once", async () => {
      const other = { ...coldZone, id: 12, iri: "dtwin:log/warehouse-01/zone-storage", propsJson: { zoneType: "storage" } };
      mockLimit.mockResolvedValueOnce([coldZone]).mockResolvedValueOnce([other]).mockResolvedValueOnce([coldZone]);
      const result = await ingestTelemetry(
        [
          { twinIri: coldZone.iri, telemetry: { temperature: 4.4 } },
          { twinIri: other.iri, telemetry: { temperature: 12 } },
          { twinIri: coldZone.iri, telemetry: { humidity: 52 } },
        ],
        { workspaceId: 1 },
      );
      expect(renderWhere(mockWhere.mock.calls.length - 1).params).toEqual([12, 55, 1]);
      expect(mockSet).toHaveBeenCalledTimes(2);
      expect(result.updatedTwins.map((t) => [t.twinIri, t.updatedKeys])).toEqual([
        [other.iri, ["temperature"]],
        [coldZone.iri, ["temperature", "humidity"]],
      ]);
    });

    it("reports a twin deleted between its lookup and the lock as unresolved, and writes nothing for it", async () => {
      mockLimit.mockResolvedValueOnce([coldZone]);
      mockLocked.mockResolvedValueOnce([]);
      const result = await ingestTelemetry([{ twinIri: coldZone.iri, telemetry: { temperature: 4.4 } }], { workspaceId: 1 });
      expect(result).toMatchObject({ success: false, updatedTwins: [], errors: [`Could not resolve device '${coldZone.iri}' to an active digital twin`] });
      expect(mockSet).not.toHaveBeenCalled();
      expect(writeAudit).not.toHaveBeenCalled();
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

    it("reports each point's problem in the order of the points", async () => {
      mockLimit.mockResolvedValueOnce([coldZone]);
      const result = await ingestTelemetry(
        [
          { twinIri: coldZone.iri, telemetry: { temperature: Infinity } },
          { deviceId: "ghost", telemetry: { temperature: 1 } },
        ],
        { workspaceId: 1 },
      );
      expect(result.errors).toEqual([
        `Rejected non-finite value for 'temperature' on ${coldZone.iri}`,
        "Could not resolve device 'ghost' to an active digital twin",
      ]);
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
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
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

  describe("broker messages (ingestBrokerMessage)", () => {
    const lease = { name: "iot-consumer", owner: "worker-a", generation: 7 };
    const from = { lease, connectorId: 5, workspaceId: 1, source: "mqtt:Plant broker" };
    const message = (telemetry: Record<string, unknown>) =>
      readBrokerMessage("ontos/twins/T1/telemetry", Buffer.from(JSON.stringify({ twinIri: coldZone.iri, telemetry })), "ontos/twins/+/telemetry");
    const duplicate = () => Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY", errno: 1062 });

    beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
    // The rules run a test scheduled finish before the next test starts.
    afterEach(() => vi.runOnlyPendingTimersAsync());

    it("checks the lease first, marks the message seen, then writes the twin, all in one transaction", async () => {
      mockLimit.mockResolvedValueOnce([coldZone]);
      const msg = message({ temperature: 4.4 });
      await expect(ingestBrokerMessage(from, msg)).resolves.toBe("recorded");

      expect(writes).toEqual([
        `begin {"isolationLevel":"read committed"}`,
        "insert iot_message_seen",
        "update kg_nodes",
        "insert twin_state_log",
        "audit",
        "commit",
      ]);
      // The lease as this consumer took it, held shared until the commit.
      expect(mockFence).toHaveBeenCalledWith("share");
      const fenceWhere = mockWhere.mock.calls.map((c) => dialect.sqlToQuery(c[0] as SQL)).find((q) => q.sql.includes("`leases`"));
      expect(fenceWhere?.params).toEqual(["iot-consumer", "worker-a", 7]);
      expect(mockValues).toHaveBeenCalledWith({ connectorId: 5, fingerprint: msg.fingerprint });
      expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ actor: "mqtt:Plant broker", entityType: "iot_telemetry" }), mockDb);
    });

    it("writes nothing when the lease is no longer this consumer's", async () => {
      mockLimit.mockResolvedValueOnce([coldZone]);
      mockFence.mockResolvedValueOnce([]);
      await expect(ingestBrokerMessage(from, message({ temperature: 4.4 }))).resolves.toBe("fenced");
      expect(writes.filter((w) => w !== "commit" && !w.startsWith("begin"))).toEqual([]);
      expect(mockSet).not.toHaveBeenCalled();
    });

    it("writes nothing more for a message recorded before: its seen mark is refused", async () => {
      mockLimit.mockResolvedValueOnce([coldZone]);
      mockValues.mockImplementationOnce(async () => {
        throw duplicate();
      });
      await expect(ingestBrokerMessage(from, message({ temperature: 4.4 }))).resolves.toBe("duplicate");
      expect(mockSet).not.toHaveBeenCalled();
      expect(writeAudit).not.toHaveBeenCalled();
    });

    it("throws when it cannot record it, so the message is not acknowledged", async () => {
      mockLimit.mockResolvedValueOnce([coldZone]);
      mockValues.mockImplementationOnce(async () => {
        throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      });
      await expect(ingestBrokerMessage(from, message({ temperature: 4.4 }))).rejects.toThrow("ECONNREFUSED");
    });

    it("runs the insight rules shortly after, once for however many messages came meanwhile", async () => {
      for (let i = 0; i < 3; i++) {
        mockLimit.mockResolvedValueOnce([coldZone]);
        await ingestBrokerMessage(from, message({ temperature: 4 + i }));
      }
      expect(reconcileInsights).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      expect(reconcileInsights).toHaveBeenCalledOnce();
      expect(reconcileInsights).toHaveBeenCalledWith(1);
    });

    it("and never two runs at once: one asked for during a run follows it", async () => {
      let finish = () => undefined as void;
      vi.mocked(reconcileInsights).mockImplementationOnce(
        () => new Promise((resolve) => (finish = () => resolve({ scanned: { nodes: 0, edges: 0 }, results: [] }))),
      );
      reconcileInsightsSoon(3, 10);
      await vi.advanceTimersByTimeAsync(10);
      reconcileInsightsSoon(3, 10);
      reconcileInsightsSoon(3, 10);
      await vi.advanceTimersByTimeAsync(50);
      expect(reconcileInsights).toHaveBeenCalledTimes(1);
      finish();
      await vi.advanceTimersByTimeAsync(10);
      expect(reconcileInsights).toHaveBeenCalledTimes(2);
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

    it("records a reading older than the twin's lastTickAt in history without rewinding its live state", async () => {
      const live = { ...coldZone, propsJson: { ...coldZone.propsJson, temperature: 4.0, lastTickAt: "2026-09-21T20:00:00.000Z" } };
      mockLimit.mockResolvedValueOnce([live]);

      const result = await ingestTelemetry(
        [{ twinIri: live.iri, timestamp: "2026-09-20T08:00:00.000Z", telemetry: { temperature: 9.5 } }],
        { workspaceId: 1 },
      );

      // Live state untouched: no propsJson write, no twin reported as updated.
      expect(mockSet).not.toHaveBeenCalled();
      expect(result.updatedTwins).toEqual([]);
      // History keeps the reading at its own time.
      expect(loggedRows().map((r) => [r.key, r.valueNum, new Date(r.recordedAt as Date).toISOString()])).toEqual([
        ["temperature", 9.5, "2026-09-20T08:00:00.000Z"],
      ]);
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

    it("rejects non-finite numeric telemetry and keeps the finite readings beside it", async () => {
      // JSON `1e400` parses to Infinity.
      const points = JSON.parse(
        `[{"twinIri":"${coldZone.iri}","telemetry":{"temperature":1e400,"humidity":55}}]`,
      ) as RawTelemetryPoint[];
      mockLimit.mockResolvedValueOnce([coldZone]);

      const result = await ingestTelemetry(points, { workspaceId: 1 });

      expect(result.success).toBe(false);
      expect(result.errors).toEqual([`Rejected non-finite value for 'temperature' on ${coldZone.iri}`]);
      expect(loggedRows().map((r) => [r.key, r.valueNum])).toEqual([["humidity", 55]]);
      const written = lastPropsWrite();
      expect(written.humidity).toBe(55);
      expect(written.temperature).toBe(coldZone.propsJson.temperature);
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
