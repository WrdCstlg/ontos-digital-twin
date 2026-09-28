/**
 * One workspace's members can neither read nor change another workspace's
 * data, and each member sees only what their role allows. Run against an
 * in-memory database holding two workspaces (memoryDb.ts), so each test checks
 * what was read or written, not the shape of a query.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type Table } from "drizzle-orm";
import type { User } from "@db/schema";
import {
  actionSubmissions,
  actionTypeVersions,
  connectors,
  iotConnectors,
  jobs,
  mappings,
  ontologyModules,
  syncJobs,
  users,
  workspaceMembers,
} from "@db/schema";
import { appRouter } from "../router";
import { iotBrokerManager } from "../services/iot/iotBrokerManager";
import { leaseLapse } from "../services/jobs/queue";
import { createMockContext, mockAdminUser, mockOntologistUser, mockViewerUser, mockWorkspace, mockWorkspaceBeta } from "./testHarness";

const store = vi.hoisted(() => ({ tables: new Map<string, Record<string, unknown>[]>() }));
vi.mock("../queries/connection", async () => ({ getDb: (await import("./memoryDb")).memoryDbFor(store.tables) }));
vi.mock("../services/audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/audit")>()),
  writeAudit: vi.fn(async () => undefined),
}));

const A = mockWorkspace; // the other workspace
const B = mockWorkspaceBeta; // the caller's
const at = new Date("2026-01-01T00:00:00Z");
const rows = (t: Table) => store.tables.get(getTableName(t)) ?? [];
const put = (t: Table, r: Record<string, unknown>[]) => store.tables.set(getTableName(t), r.map((x) => ({ ...x })));

/** A caller who is a member of workspace B in `role`. */
const inB = (user: User, role: "viewer" | "editor" | "ontologist" | "admin") =>
  appRouter.createCaller(
    createMockContext({ user, workspace: B, membership: { id: 900 + user.id, workspaceId: B.id, userId: user.id, role, moduleScope: null, createdAt: at } }),
  );

const mapping = (id: number, connectorId: number, moduleId: number, name: string) => ({
  id, connectorId, moduleId, name, sourceTable: "people", classIri: `${name}:Person`,
  columnMapJson: { subject: "hr:person/{id}", fields: { salary: `${name}:salary` } }, status: "active", createdAt: at, updatedAt: at,
});
const broker = (id: number, workspaceId: number) => ({
  id, workspaceId, name: `Broker ${id}`, brokerType: "mqtt", endpointUrl: `mqtts://broker-${id}.example:8883`, topicPattern: null, clientId: null,
  authType: "none", status: "connected", configJson: {}, lastConnectedAt: null, messageCount: 0, errorCount: 0, lastError: null, createdAt: at,
});

beforeEach(() => {
  store.tables.clear();
  put(ontologyModules, [
    { id: 10, workspaceId: A.id, key: "hr", name: "HR", status: "active" },
    { id: 20, workspaceId: B.id, key: "hr", name: "HR", status: "active" },
  ]);
  put(connectors, [
    { id: 1, workspaceId: A.id, name: "A HRIS", type: "csv", configJson: { filename: "a.csv" }, status: "connected", createdAt: at },
    { id: 2, workspaceId: B.id, name: "B HRIS", type: "csv", configJson: { filename: "b.csv" }, status: "connected", createdAt: at },
  ]);
  put(mappings, [mapping(100, 1, 10, "alpha"), mapping(200, 2, 20, "beta")]);
  put(iotConnectors, [broker(5, A.id), broker(6, B.id)]);
});
afterEach(() => vi.restoreAllMocks());

describe("mappings belong to a workspace through their connector", () => {
  const change = (id: number) => ({
    id, name: "Taken", connectorId: 2, moduleKey: "hr", sourceTable: "people", classIri: "beta:Person",
    columnMap: { subject: "hr:person/{id}" }, status: "active" as const,
  });

  it("a member cannot change another workspace's mapping, even onto their own connector", async () => {
    await expect(inB(mockOntologistUser, "ontologist").mapping.upsertMapping(change(100))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(rows(mappings).find((m) => m.id === 100)).toMatchObject({ connectorId: 1, name: "alpha" });
  });

  it("but changes their own", async () => {
    await inB(mockOntologistUser, "ontologist").mapping.upsertMapping(change(200));
    expect(rows(mappings).find((m) => m.id === 200)).toMatchObject({ connectorId: 2, name: "Taken" });
  });

  it("a member cannot read another workspace's mapping through a CSV preview", async () => {
    const preview = (mappingId: number) =>
      inB(mockViewerUser, "viewer").mapping.previewCsv({ filename: "x.csv", csvText: "id,salary\n1,100", mappingId });
    await expect(preview(100)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const own = await preview(200);
    expect(own.instances[0].classIri).toBe("beta:Person");
  });
});

describe("broker connectors are managed by the workspace's admins, and only its own", () => {
  const upsert = (id?: number) => ({ id, name: "Mine", brokerType: "mqtt" as const, endpointUrl: "mqtts://mine.example:8883", authType: "none" as const, connectNow: true });

  it("a viewer can neither save, connect, delete nor feed a broker", async () => {
    const viewer = inB(mockViewerUser, "viewer");
    await expect(viewer.iot.upsertConnector(upsert())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(viewer.iot.toggleConnector({ id: 6, enable: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(viewer.iot.deleteConnector({ id: 6 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(viewer.iot.ingestTelemetry({ points: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("nor can an editor or ontologist manage one: brokers, and their credentials, are an admin's", async () => {
    for (const role of ["editor", "ontologist"] as const) {
      const member = inB(mockOntologistUser, role);
      await expect(member.iot.upsertConnector(upsert()), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(member.iot.toggleConnector({ id: 6, enable: false }), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(member.iot.deleteConnector({ id: 6 }), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(rows(iotConnectors).map((c) => c.id)).toEqual([5, 6]);
  });

  it("an admin cannot restart, stop or delete another workspace's live broker", async () => {
    const start = vi.spyOn(iotBrokerManager, "startBroker").mockResolvedValue(true);
    const stop = vi.spyOn(iotBrokerManager, "stopBroker").mockResolvedValue(undefined);
    const admin = inB(mockAdminUser, "admin");
    await expect(admin.iot.upsertConnector(upsert(5))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(admin.iot.toggleConnector({ id: 5, enable: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(admin.iot.deleteConnector({ id: 5 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(rows(iotConnectors).find((c) => c.id === 5)).toMatchObject({ workspaceId: A.id, name: "Broker 5", status: "connected" });
  });

  it("but manages their own", async () => {
    const stop = vi.spyOn(iotBrokerManager, "stopBroker").mockResolvedValue(undefined);
    await inB(mockAdminUser, "admin").iot.deleteConnector({ id: 6 });
    expect(stop).toHaveBeenCalledWith(6);
    expect(rows(iotConnectors).map((c) => c.id)).toEqual([5]);
  });
});

describe("what members see of each other and of the workspace's work", () => {
  it("a workspace admin sees its members, never their password hashes", async () => {
    put(users, [{ ...mockViewerUser, passwordHash: "scrypt$SENTINEL-HASH" }, { ...mockAdminUser, passwordHash: "scrypt$SENTINEL-HASH-2" }]);
    put(workspaceMembers, [
      { id: 1, workspaceId: B.id, userId: mockViewerUser.id, role: "viewer", moduleScope: null, createdAt: at },
      { id: 2, workspaceId: B.id, userId: mockAdminUser.id, role: "admin", moduleScope: null, createdAt: at },
    ]);
    const members = await inB(mockAdminUser, "admin").admin.listMembers();
    expect(members.map((m) => m.user?.email).sort()).toEqual([mockAdminUser.email, mockViewerUser.email].sort());
    expect(JSON.stringify(members)).not.toContain("SENTINEL-HASH");
  });

  it("the dashboard's last import is this workspace's newest, however many newer imports another workspace ran", async () => {
    put(syncJobs, [
      { id: 1, mappingId: 200, status: "failed", rowsProcessed: 0, createdAt: at },
      { id: 2, mappingId: 200, status: "succeeded", rowsProcessed: 4, createdAt: at },
      ...Array.from({ length: 60 }, (_, i) => ({ id: 3 + i, mappingId: 100, status: "succeeded", rowsProcessed: 1, createdAt: at })),
    ]);
    const { kpis } = await inB(mockViewerUser, "viewer").dashboard.overview();
    expect(kpis.lastSync).toMatchObject({ id: 2, mappingId: 200 });
    put(syncJobs, [{ id: 1, mappingId: 100, status: "succeeded", rowsProcessed: 1, createdAt: at }]);
    expect((await inB(mockViewerUser, "viewer").dashboard.overview()).kpis.lastSync).toBeNull();
  });

  it("the narrative counts this workspace's imports, not every workspace's", async () => {
    put(syncJobs, [
      ...[1, 2, 3].map((id) => ({ id, mappingId: 100, status: "succeeded", rowsProcessed: 1, createdAt: at })),
      { id: 4, mappingId: 200, status: "succeeded", rowsProcessed: 1, createdAt: at },
    ]);
    const story = await inB(mockViewerUser, "viewer").insights.narrative({ period: "week" });
    expect(story.grounding.syncJobsTotal).toBe(1);
  });

  it("a viewer sees jobs without worker identities or webhook addresses; an admin sees them", async () => {
    const hook = "https://hooks.slack.com/services/T000/B000/SENTINEL-HOOK";
    put(jobs, [
      {
        id: 31, workspaceId: B.id, kind: "action.webhook", status: "failed", attempts: 3, maxAttempts: 3, payloadJson: { submissionId: 1, index: 0 },
        resultJson: { url: hook, status: 200 }, leaseOwner: "worker-host-1-SENTINEL", leaseExpiresAt: null,
        lastError: `webhook ${hook} answered HTTP 500; lease held by worker-host-1-SENTINEL expired; reclaimed by worker-host-2-SENTINEL`,
        createdBy: "Admin User", createdAt: at, startedAt: at, finishedAt: at, runAt: at,
      },
    ]);
    for (const read of [(c: ReturnType<typeof inB>) => c.operations.listJobs(), (c: ReturnType<typeof inB>) => c.operations.getJob({ jobId: 31 })]) {
      const seen = JSON.stringify(await read(inB(mockViewerUser, "viewer")));
      expect(seen).not.toMatch(/SENTINEL/);
      expect(seen).toContain("https://hooks.slack.com/…");
      expect(JSON.stringify(await read(inB(mockAdminUser, "admin")))).toContain("SENTINEL-HOOK");
    }
  });

  it("worker identities reach no member but an admin by any route: jobs, imports, the dashboard, an action's deliveries", async () => {
    const hook = "https://hooks.slack.com/services/T000/B000/SENTINEL-HOOK";
    const [w1, w2] = ["prod-worker-7-4242-abcd1234", "prod-worker-9-77-ffff0000"];
    put(syncJobs, [
      { id: 1, mappingId: 200, status: "failed", jobId: 41, rowsProcessed: 0, error: leaseLapse.abandoned(w1, 3, 3), startedAt: at, finishedAt: at, createdAt: at },
    ]);
    const job = (id: number, kind: string, status: string, leaseOwner: string | null, lastError: string) => ({
      id, workspaceId: B.id, kind, status, attempts: 3, maxAttempts: 3, payloadJson: {}, resultJson: null, leaseOwner, leaseExpiresAt: null,
      lastError, createdBy: "Admin User", createdAt: at, startedAt: at, finishedAt: null,
    });
    put(jobs, [
      job(41, "mapping.sync", "failed", null, leaseLapse.abandoned(w1, 3, 3)),
      job(51, "action.webhook", "running", w2, leaseLapse.reclaimed(w1, w2)),
      job(52, "action.webhook", "failed", null, `webhook ${hook} answered HTTP 500`),
    ]);
    put(actionSubmissions, [
      { id: 1, workspaceId: B.id, actionTypeId: 7, actionKey: "notify", actionVersion: 1, sideEffectJobIds: [51, 52], status: "applied", createdAt: at },
    ]);
    const definition = {
      parameters: [{ name: "person", type: "object", classIri: "hr:Person", required: true }], criteria: [], effects: [],
      sideEffects: [{ type: "webhook", url: hook }, { type: "webhook", url: hook }],
    };
    put(actionTypeVersions, [{ id: 70, actionTypeId: 7, version: 1, definitionJson: definition, changedBy: "a", createdAt: at }]);

    const everyRoute = async (c: ReturnType<typeof inB>) =>
      JSON.stringify([
        await c.operations.listJobs(),
        await c.operations.getJob({ jobId: 51 }),
        await c.mapping.listSyncJobs(),
        (await c.dashboard.overview()).kpis.lastSync,
        await c.actions.getSubmission({ id: 1 }),
      ]);
    const viewer = await everyRoute(inB(mockViewerUser, "viewer"));
    expect(viewer).not.toContain("prod-worker");
    expect(viewer).not.toContain("SENTINEL-HOOK");
    expect(viewer).toContain("lease held by a worker expired on attempt 3 of 3");
    // An ontologist authors actions, so sees where they deliver, but not who ran them.
    const ontologist = await everyRoute(inB(mockOntologistUser, "ontologist"));
    expect(ontologist).not.toContain("prod-worker");
    expect(ontologist).toContain("SENTINEL-HOOK");
    const admin = await everyRoute(inB(mockAdminUser, "admin"));
    expect(admin).toContain(w1);
    expect(admin).toContain(w2);
  });
});
