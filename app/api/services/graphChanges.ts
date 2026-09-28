import { sql } from "drizzle-orm";
import { graphDirty, graphVersions } from "@db/schema";
import { getDb } from "../queries/connection";

/**
 * Change capture for workspace graphs. MySQL holds the graph; a semantic
 * engine holds a copy of what it renders to (rdfBridge.ts), which it brings up
 * to date from what is recorded here, not by reloading everything.
 *
 * Every transaction that changes what a workspace's graph renders to records
 * it with recordGraphChange, in the same transaction: the workspace's graph
 * version goes up by one, and each subject whose statements changed is marked
 * with the new version. An engine that holds version V brings itself to the
 * current version T by replacing the subjects marked after V, from a
 * consistent snapshot of MySQL at T.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** What a transaction changed in a workspace's graph: the subjects whose statements a copy of it must replace. */
export type GraphChange = {
  /** Nodes whose own statements changed: created, edited, retyped, deleted, or a link from them added or removed. */
  nodes?: Iterable<number>;
  /**
   * Nodes that came into the graph or left it: created, revived, deleted. A
   * link renders only to a live node, so every node that links to one of
   * these changes too. Which nodes those are is read when the change is
   * applied, from the same snapshot as the rest of it (kind `incoming`).
   */
  appearedOrGone?: Iterable<number>;
  classes?: Iterable<number>;
  properties?: Iterable<number>;
  /** A change any subject's rendering may depend on (a module's prefix, a property's range): the graph is rebuilt. */
  everything?: boolean;
};

export type GraphSubjectKind = (typeof graphDirty.$inferInsert)["subjectKind"];

/** Rows per statement when marking subjects. */
const CHUNK = 1000;

/** The subjects `change` marks, each once. */
export function markedSubjects(change: GraphChange): { subjectKind: GraphSubjectKind; subjectId: number }[] {
  const out: { subjectKind: GraphSubjectKind; subjectId: number }[] = [];
  const add = (subjectKind: GraphSubjectKind, ids: Iterable<number> | undefined) => {
    for (const subjectId of new Set(ids ?? [])) {
      if (!Number.isSafeInteger(subjectId) || subjectId <= 0) throw new Error(`not a ${subjectKind} id: ${subjectId}`);
      out.push({ subjectKind, subjectId });
    }
  };
  add("node", [...(change.nodes ?? []), ...(change.appearedOrGone ?? [])]);
  add("incoming", change.appearedOrGone);
  add("class", change.classes);
  add("property", change.properties);
  if (change.everything) out.push({ subjectKind: "workspace", subjectId: 0 });
  return out;
}

/**
 * Records `change` to workspace `workspaceId`'s graph, inside the transaction
 * `tx` that made it, and returns the new version; or null, and records
 * nothing, when `change` marks no subject.
 *
 * Call it as the transaction's last write to the graph, and after its
 * writeAudit if it has one. The version row stays locked until commit: the
 * graph's writers take turns from here to their commit, so versions commit in
 * the order they were taken and none is skipped, and a change rolled back
 * takes its version with it. Taking the audit turn first in every transaction
 * that takes both keeps two of them from each holding what the other waits for.
 */
export async function recordGraphChange(tx: Tx, workspaceId: number, change: GraphChange): Promise<number | null> {
  const subjects = markedSubjects(change);
  if (subjects.length === 0) return null;

  // One statement: bump the version, or start it at 1 for a workspace that
  // has no row yet (in an epoch of its own, so a copy of it is rebuilt).
  // LAST_INSERT_ID(x) hands x back as the statement's insert id.
  const [bumped] = await tx
    .insert(graphVersions)
    .values({ workspaceId, version: sql`LAST_INSERT_ID(1)`, epoch: sql`UUID()` })
    .onDuplicateKeyUpdate({ set: { version: sql`LAST_INSERT_ID(${graphVersions.version} + 1)` } });
  const version = Number(bumped.insertId);
  if (!Number.isSafeInteger(version) || version <= 0) throw new Error(`graph version of workspace ${workspaceId} came back as ${bumped.insertId}`);

  for (let i = 0; i < subjects.length; i += CHUNK) {
    await tx
      .insert(graphDirty)
      .values(subjects.slice(i, i + CHUNK).map((s) => ({ workspaceId, ...s, version })))
      .onDuplicateKeyUpdate({ set: { version } });
  }
  return version;
}

/**
 * Records that workspace `workspaceId`'s graph was replaced, not changed: a
 * seed, a restore. A new epoch makes every copy of it rebuild. Outside any
 * transaction of the replacement's own, so call it after the replacement.
 */
export async function recordGraphReplaced(workspaceId: number, db: Db | Tx = getDb()): Promise<void> {
  await db
    .insert(graphVersions)
    .values({ workspaceId, version: 1, epoch: sql`UUID()` })
    .onDuplicateKeyUpdate({ set: { version: sql`${graphVersions.version} + 1`, epoch: sql`UUID()` } });
}
