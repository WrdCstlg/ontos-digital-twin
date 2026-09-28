import { and, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  graphDirty,
  graphVersions,
  kgEdges,
  kgNodes,
  ontologyClasses,
  ontologyModules,
  ontologyProperties,
  type KgEdge,
  type KgNode,
  type OntologyClass,
  type OntologyModule,
  type OntologyProperty,
} from "@db/schema";
import { getDb } from "../queries/connection";

/**
 * What a copy of a workspace's graph needs from MySQL to catch up, read in
 * one consistent snapshot. Change capture (graphChanges.ts) records which
 * subjects changed in which version; this reads them, and their rows as they
 * are at that version, so a copy brought to it holds exactly what MySQL held.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A workspace graph's current version, in MySQL. */
export type GraphHead = {
  version: number;
  epoch: string;
  /** Changes up to here may have been pruned: a copy older than this must rebuild. */
  minRetainedVersion: number;
};

/** The schema a graph renders with: every module, class and property of the workspace. */
export type GraphSchema = {
  modules: OntologyModule[];
  /** The classes that render: deprecated ones leave the graph. */
  classes: OntologyClass[];
  properties: OntologyProperty[];
};

/** What changed after a copy's version, up to the head, as the rows are at the head. */
export type GraphChanges = {
  head: GraphHead;
  schema: GraphSchema;
  /** A change every subject may depend on (graphChanges.ts `everything`): the copy must be rebuilt. */
  everything: boolean;
  /** The nodes whose statements must be replaced, as rows at the head, deleted ones included. */
  nodes: KgNode[];
  /** Ids of changed nodes that have no row at all. Nothing of theirs can be named, so none is replaced. */
  missingNodeIds: number[];
  /** The live links from the live changed nodes. */
  edges: KgEdge[];
  /** The live nodes those links reach, so the links render. */
  targets: KgNode[];
  /** Ids of the classes and properties whose statements must be replaced. */
  classIds: number[];
  propertyIds: number[];
};

/** Ids per IN list. */
const CHUNK = 1000;

async function inChunks<T>(ids: number[], read: (chunk: number[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await read(ids.slice(i, i + CHUNK))));
  return out;
}

/**
 * Runs `read` in a read-only transaction whose every statement sees one
 * snapshot, taken when it starts: rows committed after it, and their
 * versions, are invisible to it, so what it reads is the graph at one version.
 */
export function inSnapshot<T>(read: (tx: Tx) => Promise<T>, db: Db = getDb()): Promise<T> {
  // Not also READ ONLY: drizzle writes the two without the comma MySQL needs.
  return db.transaction(read, { isolationLevel: "repeatable read", withConsistentSnapshot: true });
}

/** The workspace graph's head, or null if its graph has never been versioned. */
export async function readGraphHead(tx: Db | Tx, workspaceId: number): Promise<GraphHead | null> {
  const [row] = await tx.select().from(graphVersions).where(eq(graphVersions.workspaceId, workspaceId));
  return row ? { version: row.version, epoch: row.epoch, minRetainedVersion: row.minRetainedVersion } : null;
}

/** The schema the workspace's graph renders with. */
export async function readGraphSchema(tx: Db | Tx, workspaceId: number): Promise<GraphSchema> {
  const modules = await tx.select().from(ontologyModules).where(eq(ontologyModules.workspaceId, workspaceId));
  const moduleIds = modules.map((m) => m.id);
  if (moduleIds.length === 0) return { modules, classes: [], properties: [] };
  const classes = await tx
    .select()
    .from(ontologyClasses)
    .where(and(inArray(ontologyClasses.moduleId, moduleIds), eq(ontologyClasses.deprecated, false)));
  const properties = await tx.select().from(ontologyProperties).where(inArray(ontologyProperties.moduleId, moduleIds));
  return { modules, classes, properties };
}

/**
 * The changes to workspace `workspaceId`'s graph after version `since`, up to
 * its head, read in `tx`, a snapshot (inSnapshot). Null if the graph has
 * never been versioned. A node that came into the graph or left it also
 * changes every node that links to it, live link or not: those are read from
 * the same snapshot.
 */
export async function readGraphChanges(tx: Tx, workspaceId: number, since: number): Promise<GraphChanges | null> {
  const head = await readGraphHead(tx, workspaceId);
  if (!head) return null;
  const dirty = await tx
    .select({ kind: graphDirty.subjectKind, id: graphDirty.subjectId })
    .from(graphDirty)
    .where(and(eq(graphDirty.workspaceId, workspaceId), gt(graphDirty.version, since), lte(graphDirty.version, head.version)));

  const ids = (kind: string) => [...new Set(dirty.filter((d) => d.kind === kind).map((d) => d.id))];
  const everything = dirty.some((d) => d.kind === "workspace");
  const schema = await readGraphSchema(tx, workspaceId);
  if (everything) {
    return { head, schema, everything, nodes: [], missingNodeIds: [], edges: [], targets: [], classIds: [], propertyIds: [] };
  }

  const linking = await inChunks(ids("incoming"), (chunk) =>
    tx
      .selectDistinct({ id: kgEdges.fromNodeId })
      .from(kgEdges)
      .where(and(eq(kgEdges.workspaceId, workspaceId), inArray(kgEdges.toNodeId, chunk))),
  );
  const nodeIds = [...new Set([...ids("node"), ...linking.map((l) => l.id)])].sort((a, b) => a - b);
  const nodes = await inChunks(nodeIds, (chunk) =>
    tx.select().from(kgNodes).where(and(eq(kgNodes.workspaceId, workspaceId), inArray(kgNodes.id, chunk))),
  );
  const found = new Set(nodes.map((n) => n.id));
  const live = nodes.filter((n) => n.deletedAt === null).map((n) => n.id);
  const edges = await inChunks(live, (chunk) =>
    tx
      .select()
      .from(kgEdges)
      .where(and(eq(kgEdges.workspaceId, workspaceId), inArray(kgEdges.fromNodeId, chunk), isNull(kgEdges.deletedAt))),
  );
  const targetIds = [...new Set(edges.map((e) => e.toNodeId))].filter((id) => !found.has(id));
  const targets = await inChunks(targetIds, (chunk) =>
    tx
      .select()
      .from(kgNodes)
      .where(and(eq(kgNodes.workspaceId, workspaceId), inArray(kgNodes.id, chunk), isNull(kgNodes.deletedAt))),
  );
  return {
    head,
    schema,
    everything,
    nodes,
    missingNodeIds: nodeIds.filter((id) => !found.has(id)),
    edges,
    targets,
    classIds: ids("class"),
    propertyIds: ids("property"),
  };
}

/**
 * Every live node of workspace `workspaceId` with its live links, in pages of
 * `pageSize` nodes by id, read in `tx` (a snapshot): a whole graph, without
 * holding it all in memory at once.
 */
export async function* readGraphPages(
  tx: Tx,
  workspaceId: number,
  pageSize = 5_000,
): AsyncGenerator<{ nodes: KgNode[]; edges: KgEdge[]; targets: KgNode[] }> {
  let after = 0;
  for (;;) {
    const nodes = await tx
      .select()
      .from(kgNodes)
      .where(and(eq(kgNodes.workspaceId, workspaceId), isNull(kgNodes.deletedAt), gt(kgNodes.id, after)))
      .orderBy(kgNodes.id)
      .limit(pageSize);
    if (nodes.length === 0) return;
    after = nodes[nodes.length - 1].id;
    const ids = nodes.map((n) => n.id);
    const edges = await inChunks(ids, (chunk) =>
      tx
        .select()
        .from(kgEdges)
        .where(and(eq(kgEdges.workspaceId, workspaceId), inArray(kgEdges.fromNodeId, chunk), isNull(kgEdges.deletedAt))),
    );
    const onPage = new Set(ids);
    const targetIds = [...new Set(edges.map((e) => e.toNodeId))].filter((id) => !onPage.has(id));
    const targets = await inChunks(targetIds, (chunk) =>
      tx
        .select()
        .from(kgNodes)
        .where(and(eq(kgNodes.workspaceId, workspaceId), inArray(kgNodes.id, chunk), isNull(kgNodes.deletedAt))),
    );
    yield { nodes, edges, targets };
  }
}

/** Records that a copy of the workspace's graph holds `version`: for pruning and for operators. */
export async function recordProjected(workspaceId: number, version: number, db: Db = getDb()): Promise<void> {
  await db
    .update(graphVersions)
    .set({ projectedVersion: sql`GREATEST(${graphVersions.projectedVersion}, ${version})`, projectedAt: sql`NOW(3)` })
    .where(eq(graphVersions.workspaceId, workspaceId));
}
