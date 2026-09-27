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
import { connectorEndpoint, isSealed, openSecret, sealSecret, sealedUnderCurrentKey, secretContext } from "../lib/secretBox";
import { appRouter } from "../router";
import { checkRunnableMapping } from "../services/mappingSync";
import { sealStoredSecrets } from "../services/secretSealing";
import { iotBrokerManager } from "../services/iot/iotBrokerManager";
import { createMockContext, mockAdminMembership, mockAdminUser, mockViewerMembership, mockViewerUser, mockWorkspace } from "./testHarness";

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
const saved = { secretsKey: env.secretsKey, secretsKeyPrevious: env.secretsKeyPrevious };
const admin = () => appRouter.createCaller(createMockContext({ user: mockAdminUser, membership: mockAdminMembership, workspace: mockWorkspace }));
const viewer = () => appRouter.createCaller(createMockContext({ user: mockViewerUser, membership: mockViewerMembership, workspace: mockWorkspace }));
const SQL_CONFIG = { driver: "mysql", host: "db.acme.corp", database: "contracts", user: "reader" };
const sqlRow = (password: unknown, extra: Record<string, unknown> = {}) => ({
  id: 7, workspaceId: WS, name: "Contracts DB", type: "sql", status: "connected", createdAt: new Date(0),
  configJson: { ...SQL_CONFIG, password, ...extra },
});
const BROKER_ENDPOINT = "mqtts://broker.acme.corp:8883";
const brokerRow = (id: number, password: unknown, clientKey: unknown) => ({
  id, workspaceId: WS, name: `Broker ${id}`, brokerType: "mqtt", endpointUrl: BROKER_ENDPOINT, topicPattern: null,
  clientId: null, authType: "tls_cert", status: "connected", lastConnectedAt: null, messageCount: 0, errorCount: 0, lastError: null,
  createdAt: new Date(0), configJson: { username: "ingest", password, caCert: "CA-PEM", clientCert: "CERT-PEM", clientKey },
});
const sqlContext = secretContext.connector(WS, "password", connectorEndpoint(SQL_CONFIG));
const iotContext = (field: string) => secretContext.iotConnector(WS, field, BROKER_ENDPOINT);

beforeEach(() => {
  env.secretsKey = KEY_A;
  env.secretsKeyPrevious = undefined;
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
  it("creating one stores the password sealed, bound to its workspace and endpoint, and answers without it", async () => {
    const created = await admin().mapping.createConnector({ name: "Contracts DB", type: "sql", config: { ...SQL_CONFIG, password: "s3cret-pw" } });
    const stored = db.inserts[0].values.configJson as Record<string, unknown>;
    expect(isSealed(stored.password)).toBe(true);
    expect(openSecret(stored.password as string, sqlContext)).toBe("s3cret-pw");
    expect(stored).toMatchObject(SQL_CONFIG);
    expect(JSON.stringify(created)).not.toContain("s3cret-pw");
    expect(created.configJson.hasPassword).toBe(true);
  });

  it("creating one refuses a password that is a sealed value, or not text: one copied from a stored row is never kept", async () => {
    const copied = sealSecret("s3cret-pw", sqlContext);
    const attempts = [
      { ...SQL_CONFIG, host: "attacker.example", password: copied },
      { ...SQL_CONFIG, password: 12345678 },
    ];
    for (const config of attempts) {
      await expect(admin().mapping.createConnector({ name: "Mine", type: "sql", config })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(db.inserts).toEqual([]);
  });

  it("browsing opens it for the driver alone", async () => {
    db.tables.set(getTableName(connectors), [sqlRow(sealSecret("s3cret-pw", sqlContext))]);
    const tables = await admin().mapping.listSqlTables({ connectorId: 7 });
    expect(pools.map((p) => p.password)).toEqual(["s3cret-pw"]);
    expect(JSON.stringify(tables)).not.toContain("s3cret-pw");
  });

  it("a row whose host was changed in the database opens nothing, and sends nothing there", async () => {
    db.tables.set(getTableName(connectors), [sqlRow(sealSecret("s3cret-pw", sqlContext), { host: "attacker.example" })]);
    await expect(admin().mapping.listSqlTables({ connectorId: 7 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(pools).toHaveLength(0);
  });

  it("a password an earlier build stored as plain text still connects", async () => {
    db.tables.set(getTableName(connectors), [sqlRow("legacy-pw")]);
    await admin().mapping.listSqlTables({ connectorId: 7 });
    expect(pools.map((p) => p.password)).toEqual(["legacy-pw"]);
  });

  it("one sealed under a key this server does not hold is refused with the reason, and no connection is tried", async () => {
    db.tables.set(getTableName(connectors), [sqlRow(sealSecret("s3cret-pw", sqlContext))]);
    env.secretsKey = KEY_B;
    await expect(admin().mapping.listSqlTables({ connectorId: 7 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringMatching(/stored password cannot be read: it was sealed under a key this server does not have.*Update password/),
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
    expect(await checkRunnableMapping(WS, 70)).toMatchObject({ ok: false, code: "BAD_REQUEST", message: expect.stringMatching(/does not have/) });
  });
});

describe("entering a SQL connector's password again", () => {
  it("an admin puts right a password this server cannot read, and the connector connects again", async () => {
    env.secretsKey = KEY_B;
    const unreadable = sealSecret("old-pw", sqlContext);
    env.secretsKey = KEY_A;
    db.tables.set(getTableName(connectors), [sqlRow(unreadable)]);
    const answered = await admin().mapping.setConnectorPassword({ connectorId: 7, password: "new-pw" });
    expect(JSON.stringify(answered)).not.toContain("new-pw");
    const set = db.updates[0].set.configJson as Record<string, unknown>;
    expect(set).toMatchObject(SQL_CONFIG);
    expect(openSecret(set.password as string, sqlContext)).toBe("new-pw");
    db.tables.set(getTableName(connectors), [sqlRow(set.password)]);
    await admin().mapping.listSqlTables({ connectorId: 7 });
    expect(pools.map((p) => p.password)).toEqual(["new-pw"]);
  });

  it("is an admin's to do, for a SQL connector of this workspace, with the password itself", async () => {
    db.tables.set(getTableName(connectors), [sqlRow("x")]);
    await expect(viewer().mapping.setConnectorPassword({ connectorId: 7, password: "p" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      admin().mapping.setConnectorPassword({ connectorId: 7, password: sealSecret("p", sqlContext) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    db.tables.set(getTableName(connectors), [{ ...sqlRow("x"), type: "csv" }]);
    await expect(admin().mapping.setConnectorPassword({ connectorId: 7, password: "p" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    db.tables.set(getTableName(connectors), []);
    await expect(admin().mapping.setConnectorPassword({ connectorId: 7, password: "p" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    db.tables.set(getTableName(connectors), [{ ...sqlRow("x"), workspaceId: WS + 1 }]);
    await expect(admin().mapping.setConnectorPassword({ connectorId: 7, password: "p" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.updates).toEqual([]);
  });
});

describe("a broker connector's password and client key are sealed at rest and opened only to connect", () => {
  it("saving one seals the password and client key for its endpoint, and leaves the certificates as they are", async () => {
    vi.spyOn(iotBrokerManager, "stopBroker").mockResolvedValue(undefined);
    await admin().iot.upsertConnector({
      name: "Plant broker", brokerType: "mqtt", endpointUrl: BROKER_ENDPOINT, authType: "tls_cert",
      username: "ingest", password: "pw-1", caCert: "CA-PEM", clientCert: "CERT-PEM", clientKey: "KEY-1", connectNow: false,
    });
    const stored = db.inserts[0].values.configJson as Record<string, unknown>;
    expect(openSecret(stored.password as string, iotContext("password"))).toBe("pw-1");
    expect(openSecret(stored.clientKey as string, iotContext("clientKey"))).toBe("KEY-1");
    expect(stored).toMatchObject({ username: "ingest", caCert: "CA-PEM", clientCert: "CERT-PEM" });
  });

  it("saving one refuses a password or client key that is a sealed value", async () => {
    vi.spyOn(iotBrokerManager, "stopBroker").mockResolvedValue(undefined);
    const base = { name: "Mine", brokerType: "mqtt" as const, endpointUrl: "mqtts://attacker.example:8883", authType: "basic" as const, connectNow: false };
    await expect(admin().iot.upsertConnector({ ...base, password: sealSecret("pw-1", iotContext("password")) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin().iot.upsertConnector({ ...base, clientKey: sealSecret("KEY-1", iotContext("clientKey")) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.inserts).toEqual([]);
  });

  it("connecting opens them for the broker, and only at the endpoint they were sealed for", async () => {
    const start = vi.spyOn(iotBrokerManager, "startBroker").mockResolvedValue(true);
    db.tables.set(getTableName(iotConnectors), [brokerRow(5, sealSecret("pw-1", iotContext("password")), sealSecret("KEY-1", iotContext("clientKey")))]);
    await admin().iot.toggleConnector({ id: 5, enable: true });
    expect(start.mock.calls[0][0]).toMatchObject({ id: 5, username: "ingest", password: "pw-1", clientKey: "KEY-1", caCert: "CA-PEM" });
    // The endpoint changed in the database: nothing opens, and nothing is sent.
    db.tables.set(getTableName(iotConnectors), [{ ...brokerRow(5, sealSecret("pw-1", iotContext("password")), undefined), endpointUrl: "mqtts://attacker.example:8883" }]);
    await expect(admin().iot.toggleConnector({ id: 5, enable: true })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(start).toHaveBeenCalledTimes(1);
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

  it("at start-up, one it cannot open stops only itself, keeps its status to be tried again, and shows why", async () => {
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
      { table: getTableName(iotConnectors), set: { lastError: expect.stringMatching(/cannot be read: it was sealed under a key this server does not have/) } },
    ]);
    // Listed as in error meanwhile; the stored status stays "connected", so the next start tries again.
    db.tables.set(getTableName(iotConnectors), [{ ...brokerRow(5, unreadable, undefined), lastError: db.updates[0].set.lastError }]);
    vi.spyOn(iotBrokerManager, "getAllStats").mockReturnValue({});
    const [listed] = await admin().iot.listConnectors();
    expect(listed.status).toBe("error");
  });
});

describe("the bootstrap brings every stored credential under the current key", () => {
  it("seals plain text, re-seals what a replaced key sealed, counts what it cannot open, and leaves the rest", async () => {
    // Sealed before SECRETS_KEY was set (under the key derived from APP_SECRET), under
    // the previous SECRETS_KEY, under a key nobody holds any more, and under the current one.
    env.secretsKey = undefined;
    const underDerived = sealSecret("derived-pw", sqlContext);
    env.secretsKey = KEY_B;
    const underPrevious = sealSecret("previous-pw", sqlContext);
    env.secretsKey = "c".repeat(64);
    const underLost = sealSecret("lost-pw", sqlContext);
    env.secretsKey = KEY_A;
    env.secretsKeyPrevious = KEY_B;
    const underCurrent = sealSecret("current-pw", sqlContext);
    db.tables.set(getTableName(connectors), [
      sqlRow("plain-pw"),
      sqlRow(underDerived),
      sqlRow(underPrevious),
      sqlRow(underLost),
      sqlRow(underCurrent),
      { ...sqlRow(undefined), configJson: null },
    ]);
    db.tables.set(getTableName(iotConnectors), [brokerRow(5, "plain-broker-pw", "plain-key")]);

    expect(await sealStoredSecrets()).toEqual({ sealed: 3, resealed: 2, unreadable: 1 });
    const opened = db.updates.map((u) => {
      const cfg = u.set.configJson as Record<string, unknown>;
      return u.table === getTableName(connectors)
        ? openSecret(cfg.password as string, sqlContext)
        : `${openSecret(cfg.password as string, iotContext("password"))}+${openSecret(cfg.clientKey as string, iotContext("clientKey"))}`;
    });
    expect(opened).toEqual(["plain-pw", "derived-pw", "previous-pw", "plain-broker-pw+plain-key"]);
    for (const u of db.updates) {
      for (const v of Object.values(u.set.configJson as Record<string, unknown>)) {
        if (isSealed(v)) expect(sealedUnderCurrentKey(v)).toBe(true);
      }
    }

    // A second start finds nothing left to seal, and still counts the one it cannot open.
    db.tables.set(getTableName(connectors), [sqlRow(underLost), ...db.updates.slice(0, 3).map((u) => ({ ...sqlRow(undefined), configJson: u.set.configJson }))]);
    db.tables.set(getTableName(iotConnectors), [{ ...brokerRow(5, undefined, undefined), configJson: db.updates[3].set.configJson }]);
    db.updates.length = 0;
    expect(await sealStoredSecrets()).toEqual({ sealed: 0, resealed: 0, unreadable: 1 });
    expect(db.updates).toEqual([]);
  });

  it("refuses to start with a malformed key, even on a fresh database with nothing to seal", async () => {
    env.secretsKey = "not a key";
    await expect(sealStoredSecrets()).rejects.toThrow(/SECRETS_KEY must be 32 bytes/);
    db.tables.set(getTableName(connectors), [sqlRow("plain-pw")]);
    await expect(sealStoredSecrets()).rejects.toThrow(/SECRETS_KEY must be 32 bytes/);
    expect(db.updates).toEqual([]);
  });
});
