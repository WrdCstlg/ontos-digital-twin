/**
 * Connector credentials are sealed at rest and opened only to connect: what
 * the routers store, what the drivers and brokers receive, what an import
 * sees, what start-up does with a credential it cannot open, and what the
 * bootstrap does with credentials earlier builds stored as plain text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { connectors, iotConnectors } from "@db/schema";
import { env } from "../lib/env";
import { isSealed, openSecret, sealSecret, secretContext } from "../lib/secretBox";
import { appRouter } from "../router";
import { checkRunnableMapping } from "../services/mappingSync";
import { sealStoredSecrets } from "../services/secretSealing";
import { iotBrokerManager } from "../services/iot/iotBrokerManager";
import { createMockContext, mockAdminMembership, mockAdminUser, mockWorkspace } from "./testHarness";

// Reads answer with the rows of the table read (or, for the import check's
// join, the joined rows); inserts and updates are recorded.
const db = vi.hoisted(() => ({
  tables: new Map<string, unknown[]>(),
  joined: [] as unknown[],
  inserts: [] as { table: string; values: Record<string, unknown> }[],
  updates: [] as { table: string; set: Record<string, unknown> }[],
}));

vi.mock("../queries/connection", async () => {
  const { getTableName: tableName } = await import("drizzle-orm");
  const thenable = (result: () => unknown) => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    Object.assign(q, {
      where: self, orderBy: self, limit: self, offset: self, innerJoin: self, leftJoin: self,
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
      catch: (reject: (e: unknown) => unknown) => Promise.resolve(result()).catch(reject),
    });
    return q;
  };
  const select = (fields?: Record<string, unknown>) => ({
    from: (t: Parameters<typeof tableName>[0]) =>
      thenable(() => {
        if (fields && "mapping" in fields && "connector" in fields) return db.joined;
        const rows = (db.tables.get(tableName(t)) ?? []) as Record<string, unknown>[];
        return fields ? rows.map((r) => Object.fromEntries(Object.keys(fields).map((k) => [k, r[k]]))) : rows;
      }),
  });
  const insert = (t: Parameters<typeof tableName>[0]) => ({
    values: (values: Record<string, unknown>) => {
      db.inserts.push({ table: tableName(t), values });
      db.tables.set(tableName(t), [{ id: 7, createdAt: new Date(0), ...values }]);
      return Object.assign(thenable(() => [{ insertId: 7 }]), { $returningId: () => Promise.resolve([{ id: 7 }]) });
    },
  });
  const update = (t: Parameters<typeof tableName>[0]) => ({
    set: (set: Record<string, unknown>) => {
      db.updates.push({ table: tableName(t), set });
      return thenable(() => [{ affectedRows: 1 }]);
    },
  });
  return { getDb: vi.fn(() => ({ select, insert, update })) };
});
vi.mock("../services/audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/audit")>()),
  writeAudit: vi.fn(async () => undefined),
}));

// The MySQL driver records how it was asked to connect.
const pools = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("mysql2/promise", () => ({
  default: {
    createPool: (opts: Record<string, unknown>) => {
      pools.push(opts);
      return { query: async () => [[{ name: "contracts", schema: "hr", rowCountEstimate: 3 }]], end: async () => undefined };
    },
  },
}));

const WS = mockWorkspace.id;
const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const saved = { secretsKey: env.secretsKey };
const admin = () => appRouter.createCaller(createMockContext({ user: mockAdminUser, membership: mockAdminMembership, workspace: mockWorkspace }));
const sqlRow = (password: unknown, extra: Record<string, unknown> = {}) => ({
  id: 7, workspaceId: WS, name: "Contracts DB", type: "sql", status: "connected", createdAt: new Date(0),
  configJson: { driver: "mysql", host: "db.acme.corp", database: "contracts", user: "reader", password, ...extra },
});
const brokerRow = (id: number, password: unknown, clientKey: unknown) => ({
  id, workspaceId: WS, name: `Broker ${id}`, brokerType: "mqtt", endpointUrl: "mqtts://broker.acme.corp:8883", topicPattern: null,
  clientId: null, authType: "tls_cert", status: "connected", lastConnectedAt: null, messageCount: 0, errorCount: 0, lastError: null,
  createdAt: new Date(0), configJson: { username: "ingest", password, caCert: "CA-PEM", clientCert: "CERT-PEM", clientKey },
});
const sqlContext = secretContext.connector(WS, "password");
const iotContext = (field: string) => secretContext.iotConnector(WS, field);

beforeEach(() => {
  env.secretsKey = KEY_A;
});
afterEach(() => {
  Object.assign(env, saved);
  db.tables.clear();
  db.joined = [];
  db.inserts.length = 0;
  db.updates.length = 0;
  pools.length = 0;
  vi.restoreAllMocks();
});

describe("a SQL connector's password is sealed at rest and opened only to connect", () => {
  it("creating one stores the password sealed, bound to its workspace, and answers without it", async () => {
    const created = await admin().mapping.createConnector({
      name: "Contracts DB", type: "sql", config: { driver: "mysql", host: "db.acme.corp", database: "contracts", user: "reader", password: "s3cret-pw" },
    });
    const stored = db.inserts[0].values.configJson as Record<string, unknown>;
    expect(isSealed(stored.password)).toBe(true);
    expect(openSecret(stored.password as string, sqlContext)).toBe("s3cret-pw");
    expect(stored).toMatchObject({ driver: "mysql", host: "db.acme.corp", database: "contracts", user: "reader" });
    expect(JSON.stringify(created)).not.toContain("s3cret-pw");
    expect(created.configJson.hasPassword).toBe(true);
  });

  it("browsing opens it for the driver alone", async () => {
    db.tables.set(getTableName(connectors), [sqlRow(sealSecret("s3cret-pw", sqlContext))]);
    const tables = await admin().mapping.listSqlTables({ connectorId: 7 });
    expect(pools.map((p) => p.password)).toEqual(["s3cret-pw"]);
    expect(JSON.stringify(tables)).not.toContain("s3cret-pw");
  });

  it("a password an earlier build stored as plain text still connects", async () => {
    db.tables.set(getTableName(connectors), [sqlRow("legacy-pw")]);
    await admin().mapping.listSqlTables({ connectorId: 7 });
    expect(pools.map((p) => p.password)).toEqual(["legacy-pw"]);
  });

  it("one sealed under another key is refused with the reason, and no connection is tried", async () => {
    db.tables.set(getTableName(connectors), [sqlRow(sealSecret("s3cret-pw", sqlContext))]);
    env.secretsKey = KEY_B;
    await expect(admin().mapping.listSqlTables({ connectorId: 7 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringMatching(/stored password cannot be read: it was sealed under a different key/),
    });
    await expect(admin().mapping.previewSqlRows({ connectorId: 7, table: "contracts" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(pools).toHaveLength(0);
  });

  it("an import opens it too, and one it cannot open fails the check with the reason", async () => {
    const mapping = { id: 70, connectorId: 7, moduleId: 1, name: "Contracts", sourceTable: "contracts", status: "active", columnMapJson: { subject: "id" } };
    db.joined = [{ mapping, connector: sqlRow(sealSecret("s3cret-pw", sqlContext)) }];
    const ok = await checkRunnableMapping(WS, 70);
    expect(ok.ok && ok.value.kind === "sql" ? ok.value.sqlConfig.password : null).toBe("s3cret-pw");
    env.secretsKey = KEY_B;
    expect(await checkRunnableMapping(WS, 70)).toMatchObject({ ok: false, code: "BAD_REQUEST", message: expect.stringMatching(/different key/) });
  });
});

describe("a broker connector's password and client key are sealed at rest and opened only to connect", () => {
  it("saving one seals the password and client key, and leaves the certificates as they are", async () => {
    vi.spyOn(iotBrokerManager, "stopBroker").mockResolvedValue(undefined);
    await admin().iot.upsertConnector({
      name: "Plant broker", brokerType: "mqtt", endpointUrl: "mqtts://broker.acme.corp:8883", authType: "tls_cert",
      username: "ingest", password: "pw-1", caCert: "CA-PEM", clientCert: "CERT-PEM", clientKey: "KEY-1", connectNow: false,
    });
    const stored = db.inserts[0].values.configJson as Record<string, unknown>;
    expect(openSecret(stored.password as string, iotContext("password"))).toBe("pw-1");
    expect(openSecret(stored.clientKey as string, iotContext("clientKey"))).toBe("KEY-1");
    expect(stored).toMatchObject({ username: "ingest", caCert: "CA-PEM", clientCert: "CERT-PEM" });
  });

  it("connecting opens them for the broker", async () => {
    const start = vi.spyOn(iotBrokerManager, "startBroker").mockResolvedValue(true);
    db.tables.set(getTableName(iotConnectors), [brokerRow(5, sealSecret("pw-1", iotContext("password")), sealSecret("KEY-1", iotContext("clientKey")))]);
    await admin().iot.toggleConnector({ id: 5, enable: true });
    expect(start.mock.calls[0][0]).toMatchObject({ id: 5, username: "ingest", password: "pw-1", clientKey: "KEY-1", caCert: "CA-PEM" });
  });

  it("one it cannot open is refused with the reason, and no connection is tried", async () => {
    const start = vi.spyOn(iotBrokerManager, "startBroker").mockResolvedValue(true);
    db.tables.set(getTableName(iotConnectors), [brokerRow(5, sealSecret("pw-1", iotContext("password")), undefined)]);
    env.secretsKey = KEY_B;
    await expect(admin().iot.toggleConnector({ id: 5, enable: true })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringMatching(/stored password or client key cannot be read/),
    });
    expect(start).not.toHaveBeenCalled();
  });

  it("at start-up, a connector it cannot open stops only itself, and says why", async () => {
    const start = vi.spyOn(iotBrokerManager, "startBroker").mockResolvedValue(true);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    env.secretsKey = KEY_B;
    const unreadable = sealSecret("old-pw", iotContext("password"));
    env.secretsKey = KEY_A;
    db.tables.set(getTableName(iotConnectors), [brokerRow(5, unreadable, undefined), brokerRow(6, sealSecret("pw-6", iotContext("password")), undefined)]);
    (iotBrokerManager as unknown as { initialized: boolean }).initialized = false;
    await iotBrokerManager.init();
    expect(start.mock.calls.map(([c]) => [c.id, c.password])).toEqual([[6, "pw-6"]]);
    expect(db.updates).toEqual([
      { table: getTableName(iotConnectors), set: { status: "error", lastError: expect.stringMatching(/cannot be read: it was sealed under a different key/) } },
    ]);
  });
});

describe("the bootstrap seals what earlier builds stored as plain text", () => {
  it("seals each plain-text credential once, counts those under another key, and leaves the rest", async () => {
    env.secretsKey = KEY_B;
    const underOtherKey = sealSecret("other-pw", sqlContext);
    env.secretsKey = KEY_A;
    const alreadySealed = sealSecret("sealed-pw", sqlContext);
    db.tables.set(getTableName(connectors), [
      sqlRow("plain-pw", { host: "plain.acme.corp" }),
      sqlRow(alreadySealed, { host: "sealed.acme.corp" }),
      sqlRow(underOtherKey, { host: "other.acme.corp" }),
      { ...sqlRow(undefined), configJson: null },
    ]);
    db.tables.set(getTableName(iotConnectors), [brokerRow(5, "plain-broker-pw", "plain-key")]);

    expect(await sealStoredSecrets()).toEqual({ sealed: 3, otherKey: 1 });
    expect(db.updates.map((u) => u.table)).toEqual([getTableName(connectors), getTableName(iotConnectors)]);
    const sql = db.updates[0].set.configJson as Record<string, unknown>;
    expect(sql.host).toBe("plain.acme.corp");
    expect(openSecret(sql.password as string, sqlContext)).toBe("plain-pw");
    const broker = db.updates[1].set.configJson as Record<string, unknown>;
    expect(openSecret(broker.password as string, iotContext("password"))).toBe("plain-broker-pw");
    expect(openSecret(broker.clientKey as string, iotContext("clientKey"))).toBe("plain-key");
    expect(broker).toMatchObject({ username: "ingest", caCert: "CA-PEM", clientCert: "CERT-PEM" });

    // A second start finds nothing left to seal.
    db.tables.set(getTableName(connectors), [{ ...sqlRow(undefined), configJson: sql }]);
    db.tables.set(getTableName(iotConnectors), [{ ...brokerRow(5, undefined, undefined), configJson: broker }]);
    db.updates.length = 0;
    expect(await sealStoredSecrets()).toEqual({ sealed: 0, otherKey: 0 });
    expect(db.updates).toEqual([]);
  });
});
