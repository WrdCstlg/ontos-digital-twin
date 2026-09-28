/**
 * Change capture on a real MySQL (services/graphChanges.ts). A change bumps
 * its workspace's graph version by one and marks each subject it changed with
 * the new version, in the transaction that made it: a change rolled back
 * leaves neither. Writers of one workspace, on any connection, get versions
 * with no gap and no repeat. And each of the graph's writers records what it
 * changed: an action, an import, an ontology edit, telemetry.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  actionTypes,
  connectors,
  graphDirty,
  graphVersions,
  kgEdges,
  kgNodes,
  mappings,
  ontologyClasses,
  ontologyModules,
  ontologyProperties,
  syncJobs,
  users,
  workspaces,
} from "@db/schema";
import { closeDb, getDb } from "../../queries/connection";
import { recordGraphChange, recordGraphReplaced } from "../../services/graphChanges";
import { loadActionType, submitAction } from "../../services/actions/service";
import { runMappingSync } from "../../services/mappingSync";
import { ingestTelemetry } from "../../services/iot/iotIngestion";
import { appRouter } from "../../router";
import { createMockContext, mockOntologistUser, mockWorkspace } from "../testHarness";
import { emptyDatabase } from "./database";

const W = mockWorkspace.id;
const at = new Date("2026-01-01T00:00:00Z");

async function versionOf(workspaceId = W) {
  const [row] = await getDb().select().from(graphVersions).where(eq(graphVersions.workspaceId, workspaceId));
  return row ?? null;
}

/** The subjects marked in workspace W, as `kind:id@version`, sorted. */
async function marks(): Promise<string[]> {
  const rows = await getDb().select().from(graphDirty).where(eq(graphDirty.workspaceId, W));
  return rows.map((r) => `${r.subjectKind}:${r.subjectId}@${r.version}`).sort();
}

beforeEach(async () => {
  await emptyDatabase();
  await getDb().insert(workspaces).values({ id: W, name: mockWorkspace.name, slug: mockWorkspace.slug });
});

afterAll(async () => {
  await closeDb();
});

describe("recordGraphChange", () => {
  it("starts a workspace with no version at 1, in an epoch of its own, then bumps it by one per change", async () => {
    expect(await versionOf()).toBeNull();
    const first = await getDb().transaction((tx) => recordGraphChange(tx, W, { nodes: [1, 2] }));
    expect(first).toBe(1);
    const started = await versionOf();
    expect(started).toMatchObject({ version: 1, minRetainedVersion: 0, projectedVersion: 0 });
    expect(started!.epoch).toMatch(/^[0-9a-f-]{36}$/);

    const second = await getDb().transaction((tx) => recordGraphChange(tx, W, { nodes: [2, 3], classes: [7] }));
    expect(second).toBe(2);
    expect((await versionOf())!.epoch).toBe(started!.epoch);
    // Each subject once, with the version that last changed it.
    expect(await marks()).toEqual(["class:7@2", "node:1@1", "node:2@2", "node:3@2"]);
  });

  it("marks a node that came or went, and the nodes that link to it, and a change to everything", async () => {
    await getDb().transaction((tx) => recordGraphChange(tx, W, { nodes: [5], appearedOrGone: [6], properties: [8], everything: true }));
    expect(await marks()).toEqual(["incoming:6@1", "node:5@1", "node:6@1", "property:8@1", "workspace:0@1"]);
  });

  it("records nothing, not even a version, for a change that marks nothing", async () => {
    expect(await getDb().transaction((tx) => recordGraphChange(tx, W, { nodes: [] }))).toBeNull();
    expect(await versionOf()).toBeNull();
  });

  it("goes with its transaction: a change rolled back leaves no version and no mark", async () => {
    await getDb().transaction((tx) => recordGraphChange(tx, W, { nodes: [1] }));
    await expect(
      getDb().transaction(async (tx) => {
        await recordGraphChange(tx, W, { nodes: [2] });
        throw new Error("the change failed after it was recorded");
      }),
    ).rejects.toThrow("the change failed");
    expect((await versionOf())!.version).toBe(1);
    expect(await marks()).toEqual(["node:1@1"]);
  });

  it("gives writers on two connection pools versions with no gap and no repeat, whatever their interleaving", async () => {
    const other = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 10 });
    const otherDb = drizzle(other, { mode: "default" });
    try {
      const writers = Array.from({ length: 40 }, (_, i) => (i % 2 ? getDb() : otherDb));
      const versions = await Promise.all(
        writers.map((db, i) =>
          db.transaction(async (tx) => {
            // Something of its own first, as a real writer does.
            await tx.execute(sql`SELECT SLEEP(${(i % 5) / 100})`);
            const v = await recordGraphChange(tx as never, W, { nodes: [100 + i, 1000] });
            await tx.execute(sql`SELECT SLEEP(${(i % 3) / 100})`);
            return v;
          }),
        ),
      );
      expect([...versions].sort((a, b) => a! - b!)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
      expect((await versionOf())!.version).toBe(40);
      // The subject every writer marked holds the last version.
      const [shared] = await getDb().select().from(graphDirty).where(and(eq(graphDirty.workspaceId, W), eq(graphDirty.subjectId, 1000)));
      expect(shared.version).toBe(40);
    } finally {
      await other.end();
    }
  });

  it("starts a replaced graph in a new epoch, its version still going up", async () => {
    await getDb().transaction((tx) => recordGraphChange(tx, W, { nodes: [1] }));
    const before = (await versionOf())!;
    await recordGraphReplaced(W);
    const after = (await versionOf())!;
    expect(after.version).toBe(before.version + 1);
    expect(after.epoch).not.toBe(before.epoch);
  });
});

describe("the migration", () => {
  it("gives every workspace there already was a version row at 0, each in an epoch of its own", async () => {
    await getDb().insert(workspaces).values({ id: W + 1, name: "Other", slug: "other" });
    const file = path.resolve(import.meta.dirname, "../../../db/migrations/0009_graph_change_capture.sql");
    const seeding = readFileSync(file, "utf8").split("--> statement-breakpoint").at(-1)!;
    expect(seeding).toContain("INSERT INTO `graph_versions`");
    await getDb().execute(sql.raw(seeding));
    const rows = await getDb().select().from(graphVersions);
    expect(rows.map((r) => [r.workspaceId, r.version]).sort()).toEqual([
      [W, 0],
      [W + 1, 0],
    ]);
    expect(new Set(rows.map((r) => r.epoch)).size).toBe(2);
  });
});

describe("the graph's writers record what they change", () => {
  async function hrModule() {
    const db = getDb();
    await db.insert(users).values({ id: mockOntologistUser.id, email: mockOntologistUser.email, name: mockOntologistUser.name, role: "ontologist" });
    await db.insert(ontologyModules).values({ id: 10, workspaceId: W, key: "hr", name: "HR", prefix: "hr", color: "#0ea5e9", version: "1.0" });
    await db.insert(ontologyClasses).values({ id: 100, moduleId: 10, iri: "hr:Person", label: "Person" });
    await db.insert(ontologyProperties).values({ id: 200, moduleId: 10, iri: "hr:reportsTo", label: "reports to", kind: "object", domainClassId: 100, rangeClassId: 100 });
  }
  const person = (id: number, name: string) => ({ id, workspaceId: W, moduleKey: "hr", classIri: "hr:Person", iri: `hr:Person/${name}`, label: name, propsJson: {} });
  const link = (fromNodeId: number, toNodeId: number) => ({ workspaceId: W, fromNodeId, toNodeId, predicateIri: "hr:reportsTo", moduleKey: "hr" });

  it("an action: what it created, changed, deleted and linked from, and the objects linking to what came or went", async () => {
    await hrModule();
    const db = getDb();
    await db.insert(kgNodes).values([person(1, "Ada"), person(2, "Bob"), person(3, "Cy"), person(4, "Dee")]);
    await db.insert(kgEdges).values([link(3, 2), link(4, 1), link(1, 2)]);
    const definition = {
      parameters: [
        { name: "keep", label: "Keep", type: "object", classIri: "hr:Person", required: true },
        { name: "drop", label: "Drop", type: "object", classIri: "hr:Person", required: true },
        { name: "boss", label: "Boss", type: "object", classIri: "hr:Person", required: true },
      ],
      criteria: [],
      rules: [
        { kind: "create_object", as: "n", classIri: "hr:Person", iri: "hr:Person/New", label: "New" },
        { kind: "modify_object", object: "keep", properties: { status: "kept" } },
        { kind: "delete_object", object: "drop" },
        { kind: "add_link", from: "n", predicate: "hr:reportsTo", to: "boss" },
        { kind: "remove_link", from: "boss", predicate: "hr:reportsTo", to: "keep" },
      ],
      validation: { shacl: false },
      sideEffects: [],
    };
    await db.insert(actionTypes).values({
      workspaceId: W, key: "reorg", version: 1, displayName: "Reorganise", moduleId: 10, status: "active", minRole: "editor", definitionJson: definition, createdAt: at,
    });
    const loaded = (await loadActionType(W, "reorg"))!;
    const submitter = { name: "Amara Okafor", userId: mockOntologistUser.id, userRole: "ontologist", memberRole: "ontologist", moduleScope: null };
    const { submission } = await submitAction(W, loaded, submitter, {
      keep: "hr:Person/Ada",
      drop: "hr:Person/Bob",
      boss: "hr:Person/Dee",
    });
    expect(submission?.status).toBe("applied");
    const [created] = await db.select().from(kgNodes).where(eq(kgNodes.iri, "hr:Person/New"));
    expect((await versionOf())!.version).toBe(1);
    expect(await marks()).toEqual([`incoming:${created.id}@1`, "incoming:2@1", `node:${created.id}@1`, "node:1@1", "node:2@1", "node:4@1"].sort());
  });

  it("an import: every node it wrote, then the nodes it linked from", async () => {
    await hrModule();
    const db = getDb();
    await db.insert(connectors).values({
      id: 1, workspaceId: W, name: "HRIS", type: "csv", status: "connected", createdAt: at,
      configJson: { filename: "p.csv", csvText: "id,name,manager\n1,Ada,\n2,Grace,1\n3,Alan,1\n" },
    });
    await db.insert(mappings).values({
      id: 100, connectorId: 1, moduleId: 10, name: "People", sourceTable: "p", classIri: "hr:Person", status: "active", createdAt: at,
      columnMapJson: { subject: "hr:person/{id}", label: "name", fields: {}, links: [{ column: "manager", predicate: "hr:reportsTo", target: "hr:person/{value}" }] },
    });
    await db.insert(syncJobs).values({ id: 7, mappingId: 100, status: "queued", rowsProcessed: 0 });

    await runMappingSync(W, { syncJobId: 7, mappingId: 100 }, "Amara Okafor", new AbortController().signal);

    const ids = Object.fromEntries((await db.select().from(kgNodes)).map((n) => [n.iri, n.id]));
    const [ada, grace, alan] = ["hr:person/1", "hr:person/2", "hr:person/3"].map((iri) => ids[iri]);
    // One batch of rows (version 1), then one of links (version 2), from Grace and Alan.
    expect((await versionOf())!.version).toBe(2);
    expect(await marks()).toEqual([`node:${ada}@1`, `node:${grace}@2`, `node:${alan}@2`].sort());
  });

  it("adding a class: the class and an object property, and the whole graph for a datatype property", async () => {
    await hrModule();
    const ontologist = appRouter.createCaller(createMockContext({ user: mockOntologistUser, workspace: mockWorkspace }));
    const withObject = await ontologist.ontology.createClass({
      moduleKey: "hr",
      label: "Team",
      properties: [{ name: "leads", kind: "object", rangeClassIri: "hr:Person" }],
    });
    expect(await marks()).toEqual([`class:${withObject.class.id}@1`, `property:${withObject.properties[0].id}@1`].sort());

    const withDatatype = await ontologist.ontology.createClass({ moduleKey: "hr", label: "Site", properties: [{ name: "city", kind: "datatype" }] });
    expect((await versionOf())!.version).toBe(2);
    expect(await marks()).toContain("workspace:0@2");
    expect(await marks()).toContain(`class:${withDatatype.class.id}@2`);
  });

  it("adding a class that fails half way leaves neither the class nor a change behind", async () => {
    await hrModule();
    const ontologist = appRouter.createCaller(createMockContext({ user: mockOntologistUser, workspace: mockWorkspace }));
    await expect(ontologist.ontology.createClass({ moduleKey: "hr", label: "Unit", properties: [{ name: "head", kind: "object" }] })).rejects.toThrow(
      /requires rangeClassIri/,
    );
    expect(await getDb().select().from(ontologyClasses).where(eq(ontologyClasses.iri, "hr:Unit"))).toEqual([]);
    expect(await versionOf()).toBeNull();
  });

  it("deprecating a class: the whole graph", async () => {
    await hrModule();
    const ontologist = appRouter.createCaller(createMockContext({ user: mockOntologistUser, workspace: mockWorkspace }));
    await ontologist.ontology.deprecateClass({ classIri: "hr:Person" });
    expect(await marks()).toEqual(["workspace:0@1"]);
  });

  it("telemetry: each twin whose state changed", async () => {
    const db = getDb();
    await db.insert(kgNodes).values({
      id: 50, workspaceId: W, moduleKey: "twin", classIri: "dtwin:LogisticsShipmentTwin", iri: "dtwin:Shipment_1", label: "Shipment 1", propsJson: { temperature: 3 },
    });
    await ingestTelemetry([{ twinIri: "dtwin:Shipment_1", timestamp: "2026-09-28T10:00:00Z", telemetry: { temperature: 5 } }], { workspaceId: W, source: "test" });
    expect(await marks()).toEqual(["node:50@1"]);
  });
});
