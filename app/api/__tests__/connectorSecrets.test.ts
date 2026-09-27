/**
 * A connector's stored secrets never leave the server, whichever read carries
 * the connector and whoever asks: a SQL password, an inline CSV payload, a
 * token in a setting the app does not know, a password in a URL. Every read
 * that returns connectors is called here, as a viewer and as an admin, against
 * connectors holding a sentinel in each place, and no sentinel may come back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { connectors, kgNodes, mappings, syncJobs } from "@db/schema";
import { appRouter } from "../router";
import {
  createMockContext,
  mockAdminMembership,
  mockAdminUser,
  mockViewerMembership,
  mockViewerUser,
  mockWorkspace,
} from "./testHarness";

// Each query answers with the rows of the table it reads, projected to the
// columns it selects, whatever its filters: order does not matter.
const db = vi.hoisted(() => ({ tables: new Map<string, unknown[]>() }));

vi.mock("../queries/connection", async () => {
  const { getTableName: tableName } = await import("drizzle-orm");
  const query = (fields?: Record<string, unknown>) => {
    let rows: Record<string, unknown>[] = [];
    const q: Record<string, unknown> = {};
    const self = () => q;
    Object.assign(q, {
      from: (t: Parameters<typeof tableName>[0]) => {
        rows = (db.tables.get(tableName(t)) ?? []) as Record<string, unknown>[];
        return q;
      },
      where: self,
      orderBy: self,
      limit: self,
      offset: self,
      innerJoin: self,
      leftJoin: self,
      groupBy: self,
      then: (resolve: (rows: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(fields ? rows.map((r) => Object.fromEntries(Object.keys(fields).map((k) => [k, r[k]]))) : rows).then(resolve, reject),
    });
    return q;
  };
  return { getDb: vi.fn(() => ({ select: (fields?: Record<string, unknown>) => query(fields) })) };
});

const SECRETS = ["SENTINEL-SQL-PASSWORD", "SENTINEL-CSV-ROW", "SENTINEL-REST-KEY", "SENTINEL-URL-PASSWORD"];
const at = new Date("2026-01-01T00:00:00Z");
const base = { workspaceId: mockWorkspace.id, status: "connected", createdAt: at };
const CONNECTORS = [
  {
    ...base, id: 11, name: "Contracts DB", type: "sql",
    configJson: { driver: "postgresql", host: "db.acme.corp", database: "contracts", user: "reader", password: "SENTINEL-SQL-PASSWORD", mode: "poll" },
  },
  { ...base, id: 12, name: "HRIS export", type: "csv", configJson: { filename: "hris.csv", rows: 1, csvText: "name\nSENTINEL-CSV-ROW" } },
  {
    ...base, id: 13, name: "ERP", type: "rest",
    configJson: { baseUrl: "https://svc:SENTINEL-URL-PASSWORD@erp.acme.corp/api/v2", auth: "api-key", apiKey: "SENTINEL-REST-KEY" },
  },
];
const mappingFor = (c: { id: number; name: string }) => ({
  id: c.id + 100, connectorId: c.id, name: `${c.name} mapping`, moduleId: 1, sourceTable: "t", status: "active", createdAt: at, updatedAt: at,
});
const NODE = {
  id: 501, workspaceId: mockWorkspace.id, iri: "hr:Employee_ada", moduleKey: "hr", label: "Ada", classIri: "hr:Employee",
  sourceMappingId: 111, sourceSubmissionId: null, createdAt: at, updatedAt: at, deletedAt: null,
};

const as = (who: "viewer" | "admin") =>
  appRouter.createCaller(
    createMockContext(
      who === "viewer"
        ? { user: mockViewerUser, membership: mockViewerMembership, workspace: mockWorkspace }
        : { user: mockAdminUser, membership: mockAdminMembership, workspace: mockWorkspace },
    ),
  );

beforeEach(() => {
  db.tables.set(getTableName(connectors), CONNECTORS);
  db.tables.set(getTableName(mappings), CONNECTORS.map(mappingFor));
  db.tables.set(getTableName(syncJobs), CONNECTORS.map((c) => ({ id: c.id + 200, mappingId: c.id + 100, jobId: null, status: "success", rowsProcessed: 1, createdAt: at })));
  db.tables.set(getTableName(kgNodes), [NODE]);
});
afterEach(() => db.tables.clear());

describe("a connector's stored secrets never leave the server", () => {
  for (const who of ["viewer", "admin"] as const) {
    it(`as ${who === "viewer" ? "a viewer" : "an admin"}: connectors, mappings, sync jobs and a node's provenance carry none`, async () => {
      const caller = as(who);
      const reads: Record<string, unknown> = {
        listConnectors: await caller.mapping.listConnectors(),
        listMappings: await caller.mapping.listMappings(),
        listSyncJobs: await caller.mapping.listSyncJobs(),
      };
      // A node imported through each connector in turn.
      for (const c of CONNECTORS) {
        db.tables.set(getTableName(connectors), [c]);
        db.tables.set(getTableName(mappings), [mappingFor(c)]);
        reads[`getNode via ${c.type}`] = await caller.graph.getNode({ iri: NODE.iri });
      }
      const leaks: string[] = [];
      for (const [read, out] of Object.entries(reads)) {
        const text = JSON.stringify(out);
        // Each read did carry connectors, so the check below saw them.
        expect(text, read).toMatch(/Contracts DB|HRIS export|ERP/);
        for (const secret of SECRETS) if (text.includes(secret)) leaks.push(`${read}: ${secret}`);
      }
      expect(leaks).toEqual([]);
    });
  }
});
