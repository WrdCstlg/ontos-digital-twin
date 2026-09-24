import { afterEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { appRouter } from "../router";
import {
  createMockContext,
  mockAdminUser,
  mockViewerUser,
  mockWorkspace,
  mockWorkspaceBeta,
  mockAdminMembership,
  mockViewerMembership,
} from "./testHarness";

vi.mock("../services/semanticEngine", () => ({
  semanticEngine: {
    ensureEngineRunning: vi.fn().mockResolvedValue(false),
    querySparql: vi.fn(),
    syncWorkspace: vi.fn(),
  },
}));

// Every `select().from(table).where(cond)` chain takes the next queued row set
// and records the table plus the drizzle WHERE expression it was given, so the
// tests can render the real SQL predicate the procedure built. `groupBy`,
// `orderBy` and `limit` pass through; the chain is awaitable at any point.
type DbCall = { table: unknown; where: unknown; limit?: number };
const dbState = vi.hoisted(() => ({ queue: [] as unknown[][], calls: [] as DbCall[] }));

vi.mock("../queries/connection", () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn((where: unknown) => {
          const call: DbCall = { table, where };
          dbState.calls.push(call);
          const rows = dbState.queue.shift() ?? [];
          const chain = {
            groupBy: () => chain,
            orderBy: () => chain,
            limit: (n: number) => {
              call.limit = n;
              return chain;
            },
            then: (
              onFulfilled?: (v: unknown[]) => unknown,
              onRejected?: (e: unknown) => unknown,
            ) => Promise.resolve(rows).then(onFulfilled, onRejected),
          };
          return chain;
        }),
      })),
    })),
  })),
}));

afterEach(() => {
  dbState.queue.length = 0;
  dbState.calls.length = 0;
});

const dialect = new MySqlDialect();

/** The recorded query `i`: its table name and the WHERE clause split into top-level AND conjuncts. */
function query(i: number) {
  const call = dbState.calls[i];
  expect(call, `query #${i} was issued`).toBeDefined();
  const { sql, params } = dialect.sqlToQuery(call.where as SQL);
  return { table: getTableName(call.table as Table), limit: call.limit, conjuncts: splitAnd(sql, params) };
}

/** Split a rendered predicate into its top-level AND terms, each with its own bound params. */
function splitAnd(sql: string, params: unknown[]) {
  let s = sql.trim();
  if (s.startsWith("(")) {
    let depth = 0;
    let close = -1;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")" && --depth === 0) {
        close = i;
        break;
      }
    }
    if (close === s.length - 1) s = s.slice(1, -1);
  }
  const out: { sql: string; params: unknown[] }[] = [];
  let depth = 0;
  let start = 0;
  let p = 0;
  let pStart = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === "?") p++;
    else if (depth === 0 && s.startsWith(" and ", i)) {
      out.push({ sql: s.slice(start, i), params: params.slice(pStart, p) });
      start = i + 5;
      pStart = p;
      i += 4;
    }
  }
  out.push({ sql: s.slice(start), params: params.slice(pStart, p) });
  return out;
}

/** Query `i` hit `table` and is conjunctively (never via OR) restricted to workspace `wsId`. */
function expectWorkspaceScoped(i: number, table: string, wsId: number) {
  const q = query(i);
  expect(q.table).toBe(table);
  expect(q.conjuncts).toContainEqual({ sql: `\`${table}\`.\`workspaceId\` = ?`, params: [wsId] });
  return q;
}

// Workspace 2 (not the harness default of 1), so a hard-coded id cannot pass.
const WS = mockWorkspaceBeta;
function betaCaller() {
  return appRouter.createCaller(
    createMockContext({
      user: mockViewerUser,
      membership: { ...mockViewerMembership, workspaceId: WS.id },
      workspace: WS,
    }),
  );
}

const nodeRow = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  workspaceId: WS.id,
  moduleKey: "hr",
  classIri: "hr:Person",
  iri: `hr:person/${id}`,
  label: `Person ${id}`,
  propsJson: {},
  sourceMappingId: null,
  deletedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  ...extra,
});
const edgeRow = (id: number, fromNodeId: number, toNodeId: number, moduleKey: string | null = "hr") => ({
  id,
  workspaceId: WS.id,
  fromNodeId,
  toNodeId,
  predicateIri: "hr:reportsTo",
  moduleKey,
  sourceMappingId: null,
  deletedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

describe("Graph Router Integration Tests", () => {
  it("rejects caller from querying foreign workspace key with FORBIDDEN", async () => {
    const caller = appRouter.createCaller(
      createMockContext({
        user: mockViewerUser,
        membership: mockViewerMembership,
        workspace: mockWorkspace,
      }),
    );

    await expect(
      caller.graph.stats({ workspaceKey: "unauthorized-workspace-slug" }),
    ).rejects.toThrow("User does not have access to workspace 'unauthorized-workspace-slug'");
    expect(dbState.calls).toHaveLength(0);
  });

  it("handles offline semantic engine gracefully during sparqlQuery", async () => {
    const caller = appRouter.createCaller(
      createMockContext({
        user: mockAdminUser,
        membership: mockAdminMembership,
        workspace: mockWorkspace,
      }),
    );

    await expect(
      caller.graph.sparqlQuery({
        query: "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10",
      }),
    ).rejects.toThrow("Semantic engine is currently offline");
  });

  it("handles offline semantic engine gracefully during syncStore", async () => {
    const caller = appRouter.createCaller(
      createMockContext({
        user: mockAdminUser,
        membership: mockAdminMembership,
        workspace: mockWorkspace,
      }),
    );

    await expect(caller.graph.syncStore()).rejects.toThrow("Semantic engine is currently offline");
  });

  it("rejects unauthenticated caller from graph endpoints", async () => {
    const caller = appRouter.createCaller(createMockContext({ user: null, workspace: null, membership: null }));
    await expect(caller.graph.syncStore()).rejects.toThrow("Authentication required");
  });
});

describe("graph.stats", () => {
  it("aggregates node/edge counts per module and returns the latest snapshot, all scoped to ctx.workspace", async () => {
    const snapshot = { id: 9, workspaceId: WS.id, label: "v9", statsJson: null, createdAt: new Date() };
    dbState.queue.push(
      [{ moduleKey: "hr", n: 5 }, { moduleKey: "fin", n: 3 }],
      [{ moduleKey: "hr", n: 4 }, { moduleKey: null, n: 2 }],
      [snapshot],
    );

    const result = await betaCaller().graph.stats();

    expect(result.workspace).toEqual({ id: WS.id, name: WS.name, slug: WS.slug });
    expect(result.totals).toEqual({ nodes: 8, edges: 6 });
    expect(result.byModule).toEqual({
      hr: { nodes: 5, edges: 4 },
      fin: { nodes: 3, edges: 0 },
      cross: { nodes: 0, edges: 2 },
    });
    expect(result.snapshot).toEqual(snapshot);

    expect(dbState.calls).toHaveLength(3);
    const nodes = expectWorkspaceScoped(0, "kg_nodes", WS.id);
    expect(nodes.conjuncts).toContainEqual({ sql: "`kg_nodes`.`deletedAt` is null", params: [] });
    const edges = expectWorkspaceScoped(1, "kg_edges", WS.id);
    expect(edges.conjuncts).toContainEqual({ sql: "`kg_edges`.`deletedAt` is null", params: [] });
    const snap = expectWorkspaceScoped(2, "graph_snapshots", WS.id);
    expect(snap.limit).toBe(1);
  });

  it.each([
    ["slug", WS.slug],
    ["numeric id", String(WS.id)],
    ["name", WS.name],
  ])("accepts the caller's own workspace by %s and reports no snapshot when none exists", async (_kind, key) => {
    dbState.queue.push([], [], []);

    const result = await betaCaller().graph.stats({ workspaceKey: key });

    expect(result.totals).toEqual({ nodes: 0, edges: 0 });
    expect(result.byModule).toEqual({});
    expect(result.snapshot).toBeNull();
    expectWorkspaceScoped(0, "kg_nodes", WS.id);
    expectWorkspaceScoped(1, "kg_edges", WS.id);
    expectWorkspaceScoped(2, "graph_snapshots", WS.id);
  });
});

describe("graph.searchNodes", () => {
  it("filters by module when moduleKey is given, inside the workspace scope", async () => {
    const rows = [nodeRow(1, { label: "Alice" })];
    dbState.queue.push(rows);

    const result = await betaCaller().graph.searchNodes({ q: "Ali", moduleKey: "hr", limit: 5 });

    expect(result).toEqual(rows);
    expect(dbState.calls).toHaveLength(1);
    const q = expectWorkspaceScoped(0, "kg_nodes", WS.id);
    expect(q.conjuncts).toContainEqual({ sql: "`kg_nodes`.`moduleKey` = ?", params: ["hr"] });
    expect(q.conjuncts).toContainEqual({ sql: "`kg_nodes`.`deletedAt` is null", params: [] });
    expect(q.conjuncts).toContainEqual({
      sql: "(`kg_nodes`.`label` like ? or `kg_nodes`.`iri` like ?)",
      params: ["%Ali%", "%Ali%"],
    });
    expect(q.limit).toBe(5);
  });

  it("applies no module predicate when moduleKey is omitted, and defaults the limit to 20", async () => {
    dbState.queue.push([]);

    await betaCaller().graph.searchNodes({ q: "Ali" });

    const q = expectWorkspaceScoped(0, "kg_nodes", WS.id);
    expect(q.conjuncts.some((c) => c.sql.includes("`moduleKey`"))).toBe(false);
    expect(q.limit).toBe(20);
  });
});

describe("graph.getSubgraph", () => {
  it("expands one hop, scopes every lookup to the workspace, and drops edges whose far node was not returned", async () => {
    const center = nodeRow(10);
    const e1 = edgeRow(501, 10, 11);
    const e2 = edgeRow(502, 12, 10);
    const dangling = edgeRow(503, 10, 99); // node 99 is not in this workspace's result set
    dbState.queue.push([center], [e1, e2, dangling], [nodeRow(11), nodeRow(12)]);

    const result = await betaCaller().graph.getSubgraph({ centerIri: center.iri });

    expect(result.center).toBe(center.iri);
    expect(result.depth).toBe(1);
    expect(result.nodes.map((n) => n.id)).toEqual([10, 11, 12]);
    expect(result.edges.map((e) => e.id)).toEqual([501, 502]);

    expect(dbState.calls).toHaveLength(3);
    const c = expectWorkspaceScoped(0, "kg_nodes", WS.id);
    expect(c.conjuncts).toContainEqual({ sql: "`kg_nodes`.`iri` = ?", params: [center.iri] });
    const hop = expectWorkspaceScoped(1, "kg_edges", WS.id);
    expect(hop.conjuncts).toContainEqual({
      sql: "(`kg_edges`.`fromNodeId` in (?) or `kg_edges`.`toNodeId` in (?))",
      params: [10, 10],
    });
    expect(hop.limit).toBe(80 * 4);
    const neighbours = expectWorkspaceScoped(2, "kg_nodes", WS.id);
    expect(neighbours.conjuncts).toContainEqual({ sql: "`kg_nodes`.`id` in (?, ?, ?)", params: [11, 12, 99] });
  });

  it("walks a second hop from the new frontier when depth=2, still workspace-scoped", async () => {
    const center = nodeRow(10);
    const e1 = edgeRow(601, 10, 11);
    const e2 = edgeRow(602, 11, 13);
    dbState.queue.push([center], [e1], [nodeRow(11)], [e1, e2], [nodeRow(13)]);

    const result = await betaCaller().graph.getSubgraph({ centerIri: center.iri, depth: 2, limit: 10 });

    expect(result.nodes.map((n) => n.id)).toEqual([10, 11, 13]);
    expect(result.edges.map((e) => e.id)).toEqual([601, 602]);
    expect(dbState.calls).toHaveLength(5);
    const hop2 = expectWorkspaceScoped(3, "kg_edges", WS.id);
    expect(hop2.conjuncts).toContainEqual({
      sql: "(`kg_edges`.`fromNodeId` in (?) or `kg_edges`.`toNodeId` in (?))",
      params: [11, 11],
    });
    expect(hop2.limit).toBe(40);
    const hop2Nodes = expectWorkspaceScoped(4, "kg_nodes", WS.id);
    expect(hop2Nodes.conjuncts).toContainEqual({ sql: "`kg_nodes`.`id` in (?)", params: [13] });
  });

  it("returns NOT_FOUND when the centre IRI is not in the caller's workspace", async () => {
    dbState.queue.push([]);

    await expect(betaCaller().graph.getSubgraph({ centerIri: "hr:person/elsewhere" })).rejects.toThrow(
      "Node 'hr:person/elsewhere' not found",
    );
    expect(dbState.calls).toHaveLength(1);
    expectWorkspaceScoped(0, "kg_nodes", WS.id);
  });
});

describe("graph.getNode", () => {
  it("returns the node with in/out edges, neighbours, module and provenance from workspace-scoped reads", async () => {
    const node = nodeRow(20, { sourceMappingId: 7 });
    const out = edgeRow(301, 20, 21, "hr");
    const inc = edgeRow(302, 22, 20, null);
    const n21 = nodeRow(21);
    const n22 = nodeRow(22);
    const mapping = { id: 7, connectorId: 3, moduleId: 5, name: "HRIS people" };
    const connector = { id: 3, workspaceId: WS.id, name: "HRIS", type: "csv" };
    const hrModule = { id: 5, workspaceId: WS.id, key: "hr", name: "HR" };
    dbState.queue.push([node], [out], [inc], [n21, n22], [mapping], [connector], [hrModule]);

    const result = await betaCaller().graph.getNode({ iri: node.iri });

    expect(result.node).toEqual(node);
    expect(result.module).toEqual(hrModule);
    expect(result.outgoing).toEqual([{ edge: out, direction: "out", other: n21, module: hrModule }]);
    expect(result.incoming).toEqual([{ edge: inc, direction: "in", other: n22, module: null }]);
    expect(result.provenance).toEqual({
      mapping,
      connector,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    });

    expect(dbState.calls).toHaveLength(7);
    const n = expectWorkspaceScoped(0, "kg_nodes", WS.id);
    expect(n.conjuncts).toContainEqual({ sql: "`kg_nodes`.`iri` = ?", params: [node.iri] });
    const o = expectWorkspaceScoped(1, "kg_edges", WS.id);
    expect(o.conjuncts).toContainEqual({ sql: "`kg_edges`.`fromNodeId` = ?", params: [20] });
    const i = expectWorkspaceScoped(2, "kg_edges", WS.id);
    expect(i.conjuncts).toContainEqual({ sql: "`kg_edges`.`toNodeId` = ?", params: [20] });
    // Neighbour lookup is by id only (no workspace predicate, unlike getSubgraph);
    // it is bounded to endpoints of the workspace-scoped edge rows above.
    const nb = query(3);
    expect(nb.table).toBe("kg_nodes");
    expect(nb.conjuncts).toEqual([{ sql: "`kg_nodes`.`id` in (?, ?)", params: [21, 22] }]);
    expectWorkspaceScoped(6, "ontology_modules", WS.id);
  });

  it("skips provenance lookups when the node has no source mapping", async () => {
    const node = nodeRow(30);
    dbState.queue.push([node], [], [], []);

    const result = await betaCaller().graph.getNode({ iri: node.iri });

    expect(result.outgoing).toEqual([]);
    expect(result.incoming).toEqual([]);
    expect(result.module).toBeNull();
    expect(result.provenance.mapping).toBeNull();
    expect(result.provenance.connector).toBeNull();
    // node, outgoing, incoming, modules — no neighbour or mapping/connector reads
    expect(dbState.calls.map((c) => getTableName(c.table as Table))).toEqual([
      "kg_nodes",
      "kg_edges",
      "kg_edges",
      "ontology_modules",
    ]);
    expectWorkspaceScoped(3, "ontology_modules", WS.id);
  });

  it("returns NOT_FOUND when the IRI is not in the caller's workspace", async () => {
    dbState.queue.push([]);

    await expect(betaCaller().graph.getNode({ iri: "hr:person/elsewhere" })).rejects.toThrow(
      "Node 'hr:person/elsewhere' not found",
    );
    expect(dbState.calls).toHaveLength(1);
    expectWorkspaceScoped(0, "kg_nodes", WS.id);
  });
});
