/**
 * Each workspace's counts and summaries are its own, in real SQL. The routes
 * here group and count (GROUP BY, count, max, timestampdiff), which the
 * in-memory database the other scoping tests use refuses to run. Two
 * workspaces hold the same module key, class and action key, so a query that
 * lost its workspace filter would count the other's rows.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  actionSubmissions,
  actionTypes,
  connectors,
  graphSnapshots,
  insights,
  jobs,
  kgEdges,
  kgNodes,
  mappings,
  ontologyClasses,
  ontologyModules,
  ontologyProperties,
  syncJobs,
  users,
  workers,
  workspaces,
  type Workspace,
} from "@db/schema";
import { appRouter } from "../../router";
import { closeDb, getDb } from "../../queries/connection";
import { createMockContext, mockViewerUser, mockWorkspace, mockWorkspaceBeta } from "../testHarness";
import { emptyDatabase } from "./database";

const A = mockWorkspace;
const B = mockWorkspaceBeta;
const at = new Date("2026-01-01T00:00:00Z");

/** A viewer in workspace `ws`. */
const viewerIn = (ws: Workspace) =>
  appRouter.createCaller(
    createMockContext({
      user: mockViewerUser,
      workspace: ws,
      membership: { id: 900 + ws.id, workspaceId: ws.id, userId: mockViewerUser.id, role: "viewer", moduleScope: null, createdAt: at },
    }),
  );

const definition = {
  parameters: [{ name: "person", label: "Person", type: "object", classIri: "hr:Person", required: true }],
  criteria: [],
  rules: [{ kind: "modify_object", object: "person", properties: { status: "promoted" } }],
  validation: { shacl: false },
  sideEffects: [],
};

beforeAll(async () => {
  await emptyDatabase();
  const db = getDb();
  await db.insert(users).values({ id: mockViewerUser.id, email: mockViewerUser.email, name: mockViewerUser.name, role: "viewer" });
  await db.insert(workspaces).values([
    { id: A.id, name: A.name, slug: A.slug },
    { id: B.id, name: B.name, slug: B.slug },
  ]);
  const module = { key: "hr", name: "HR", prefix: "hr", color: "#0ea5e9", version: "1.0" };
  await db.insert(ontologyModules).values([
    { id: 10, workspaceId: A.id, ...module },
    { id: 20, workspaceId: B.id, ...module },
  ]);
  await db.insert(ontologyClasses).values([
    { moduleId: 10, iri: "hr:Person", label: "Person" },
    { moduleId: 10, iri: "hr:Team", label: "Team" },
    { moduleId: 10, iri: "hr:Site", label: "Site" },
    { moduleId: 20, iri: "hr:Person", label: "Person" },
  ]);
  await db.insert(ontologyProperties).values([
    { moduleId: 10, iri: "hr:name", label: "name", kind: "datatype" },
    { moduleId: 10, iri: "hr:memberOf", label: "member of", kind: "object" },
    { moduleId: 20, iri: "hr:name", label: "name", kind: "datatype" },
  ]);

  // A: five people, linked in a chain. B: two people and one deleted; a link
  // in the module, one across modules, and one deleted.
  const person = (id: number, workspaceId: number, deletedAt: Date | null = null) =>
    ({ id, workspaceId, moduleKey: "hr", classIri: "hr:Person", iri: `hr:person/${workspaceId}-${id}`, label: `Person ${id}`, deletedAt });
  await db.insert(kgNodes).values([1, 2, 3, 4, 5].map((id) => person(id, A.id)));
  await db.insert(kgNodes).values([person(11, B.id), person(12, B.id), person(13, B.id, at)]);
  const link = (workspaceId: number, fromNodeId: number, toNodeId: number, moduleKey: string | null, deletedAt: Date | null = null) =>
    ({ workspaceId, fromNodeId, toNodeId, predicateIri: "hr:knows", moduleKey, deletedAt });
  await db.insert(kgEdges).values([link(A.id, 1, 2, "hr"), link(A.id, 2, 3, "hr"), link(A.id, 3, 4, "hr")]);
  await db.insert(kgEdges).values([link(B.id, 11, 12, "hr"), link(B.id, 12, 11, null), link(B.id, 11, 12, "hr", at)]);

  // B's only import is older than all of A's.
  await db.insert(connectors).values([
    { id: 1, workspaceId: A.id, name: "A HRIS", type: "csv" },
    { id: 2, workspaceId: B.id, name: "B HRIS", type: "csv" },
  ]);
  await db.insert(mappings).values([
    { id: 100, connectorId: 1, moduleId: 10, name: "alpha", sourceTable: "people", classIri: "hr:Person" },
    { id: 200, connectorId: 2, moduleId: 20, name: "beta", sourceTable: "people", classIri: "hr:Person" },
  ]);
  await db.insert(syncJobs).values([
    { id: 1, mappingId: 200, status: "succeeded", rowsProcessed: 2 },
    ...[2, 3, 4, 5, 6].map((id) => ({ id, mappingId: 100, status: "succeeded" as const, rowsProcessed: 5 })),
  ]);

  // A's queue: four jobs waiting an hour, one failed. B's: one waiting two minutes, one running, two done.
  const job = (workspaceId: number, status: "queued" | "running" | "succeeded" | "failed", waited = sql`now()`) =>
    ({ workspaceId, kind: "mapping.sync", status, createdAt: waited });
  await db.insert(jobs).values([
    ...[1, 2, 3, 4].map(() => job(A.id, "queued", sql`now() - interval 1 hour`)),
    job(A.id, "failed"),
    job(B.id, "queued", sql`now() - interval 2 minute`),
    job(B.id, "running"),
    job(B.id, "succeeded"),
    job(B.id, "succeeded"),
  ]);
  await db.insert(workers).values([
    { id: "worker-alive", hostname: "h1", status: "running" },
    { id: "worker-silent", hostname: "h2", status: "running", lastSeenAt: sql`now() - interval 1 minute` },
  ]);

  const finding = (workspaceId: number, status: "open" | "acknowledged") =>
    ({ workspaceId, type: "anomaly" as const, severity: "risk" as const, title: "Risk", status });
  await db.insert(insights).values([finding(A.id, "open"), finding(A.id, "open"), finding(A.id, "open"), finding(B.id, "open"), finding(B.id, "acknowledged")]);
  await db.insert(graphSnapshots).values([
    { id: 1, workspaceId: B.id, label: "B's snapshot" },
    { id: 2, workspaceId: A.id, label: "A's snapshot" },
  ]);

  const promote = { key: "promote", displayName: "Promote", status: "active" as const, definitionJson: definition };
  await db.insert(actionTypes).values([
    { id: 1, workspaceId: A.id, moduleId: 10, ...promote },
    { id: 2, workspaceId: B.id, moduleId: 20, ...promote },
  ]);
  const submission = (workspaceId: number, actionTypeId: number, status: "applied" | "rejected", createdAt: Date) =>
    ({ workspaceId, actionTypeId, actionKey: "promote", actionVersion: 1, status, submittedBy: "Sam Park", createdAt });
  await db.insert(actionSubmissions).values([
    submission(A.id, 1, "applied", new Date("2026-09-20T10:00:00Z")),
    submission(A.id, 1, "applied", new Date("2026-09-21T10:00:00Z")),
    submission(A.id, 1, "applied", new Date("2026-09-22T10:00:00Z")),
    submission(B.id, 2, "applied", new Date("2026-09-01T10:00:00Z")),
    submission(B.id, 2, "rejected", new Date("2026-09-02T10:00:00Z")),
  ]);
});
afterAll(() => closeDb());

describe("each workspace's counts and summaries are its own", () => {
  it("the dashboard's totals, findings, newest import and snapshot", async () => {
    const b = (await viewerIn(B).dashboard.overview()).kpis;
    expect(b).toMatchObject({ totalNodes: 2, totalEdges: 2, totalClasses: 1, modulesActive: 1, openInsights: 1 });
    expect(b.lastSync).toMatchObject({ id: 1, mappingId: 200 });
    expect(b.snapshot).toMatchObject({ id: 1, workspaceId: B.id });

    const a = (await viewerIn(A).dashboard.overview()).kpis;
    expect(a).toMatchObject({ totalNodes: 5, totalEdges: 3, totalClasses: 3, modulesActive: 1, openInsights: 3 });
    expect(a.lastSync).toMatchObject({ id: 6, mappingId: 100 });
  });

  it("the dashboard's module health, counted per module", async () => {
    expect(await viewerIn(B).dashboard.moduleHealth()).toEqual([expect.objectContaining({ key: "hr", instances: 2, edges: 1 })]);
    expect(await viewerIn(A).dashboard.moduleHealth()).toEqual([expect.objectContaining({ key: "hr", instances: 5, edges: 3 })]);
  });

  it("the graph's statistics, with links across modules counted apart", async () => {
    const b = await viewerIn(B).graph.stats();
    expect(b.totals).toEqual({ nodes: 2, edges: 2 });
    expect(b.byModule).toEqual({ hr: { nodes: 2, edges: 1 }, cross: { nodes: 0, edges: 1 } });
    expect(b.snapshot).toMatchObject({ workspaceId: B.id });
    expect((await viewerIn(A).graph.stats()).totals).toEqual({ nodes: 5, edges: 3 });
  });

  it("the queue's depth and oldest wait, beside the workers every workspace shares", async () => {
    const b = await viewerIn(B).operations.summary();
    expect(b.byStatus).toEqual({ queued: 1, running: 1, succeeded: 2, failed: 0 });
    expect(b.oldestQueuedSeconds).toBeGreaterThanOrEqual(115);
    expect(b.oldestQueuedSeconds).toBeLessThan(180);
    expect(b.workersAlive).toBe(1);

    const a = await viewerIn(A).operations.summary();
    expect(a.byStatus).toEqual({ queued: 4, running: 0, succeeded: 0, failed: 1 });
    expect(a.oldestQueuedSeconds).toBeGreaterThanOrEqual(3595);
  });

  it("the ontology's modules and classes, with their instance counts", async () => {
    const b = viewerIn(B);
    expect(await b.ontology.listModules()).toEqual([expect.objectContaining({ key: "hr", classCount: 1, propertyCount: 1, instanceCount: 2 })]);
    expect(await b.ontology.getModule({ key: "hr" })).toMatchObject({ id: 20, classCount: 1, propertyCount: 1, instanceCount: 2 });
    expect(await b.ontology.listClasses({ moduleKey: "hr" })).toEqual([expect.objectContaining({ iri: "hr:Person", instanceCount: 2 })]);

    expect(await viewerIn(A).ontology.listModules()).toEqual([
      expect.objectContaining({ key: "hr", classCount: 3, propertyCount: 2, instanceCount: 5 }),
    ]);
  });

  it("each action type's submissions, and when it was last submitted", async () => {
    const [b] = await viewerIn(B).actions.listTypes();
    expect(b).toMatchObject({ id: 2, key: "promote", submissions: { applied: 1, rejected: 1 } });
    expect(b.submissions.lastAt).toEqual(new Date("2026-09-02T10:00:00Z"));

    const [a] = await viewerIn(A).actions.listTypes();
    expect(a.submissions).toEqual({ applied: 3, rejected: 0, lastAt: new Date("2026-09-22T10:00:00Z") });
  });
});
