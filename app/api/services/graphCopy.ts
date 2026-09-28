import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { graphVersions } from "@db/schema";
import { getDb } from "../queries/connection";
import {
  buildPrefixMap,
  datatypeRanges,
  knowledgeGraphSubjects,
  modulePrefixes,
  type TurtleSubject,
} from "./rdfBridge";
import {
  inSnapshot,
  readGraphChanges,
  readGraphHead,
  readGraphPages,
  readGraphSchema,
  recordProjected,
  type GraphHead,
} from "./graphSnapshot";
import { META_QUERY, planUpdates, readCopyMeta, rebuildReason, rebuiltMeta, renderChanges, schemaSubjects, type CopyMeta } from "./graphProjection";
import type { SparqlResult } from "./semanticEngine";

/**
 * Brings a workspace's copy of its graph, in a semantic engine of its own, up
 * to MySQL's current version (graphProjection.ts says how). Run it under the
 * workspace's engine lock: the lock keeps two catch-ups from doing the same
 * work, and the fence keeps one that lost the lock from doing harm.
 */

/** A copy of one workspace's graph: an engine holding it, and nothing else. */
export interface CopyEngine {
  /** Answers a SPARQL SELECT. */
  query(sparql: string): Promise<SparqlResult>;
  /** Applies a SPARQL UPDATE whole, or not at all and throws. */
  update(sparql: string): Promise<void>;
  /** Empties the copy, for a rebuild. */
  reset(): Promise<void>;
  /** Loads `subjects` into the copy's default graph, and answers how many triples it holds after. */
  load(prefixMap: Map<string, string>, subjects: AsyncIterable<TurtleSubject>): Promise<number>;
}

/** A catch-up's outcome. */
export type CatchUp =
  | { kind: "current"; version: number }
  | { kind: "caught-up"; from: number; version: number; subjects: number; requests: number }
  | { kind: "rebuilt"; version: number; reason: string; triples: number };

/** Another writer took the copy over while this catch-up ran: it stopped, changing nothing more. */
export class CopyTakenOver extends Error {}

/** A request's size limit: the engine refuses a body over 2 MiB, and the JSON around a query takes a little. */
export const UPDATE_REQUEST_BYTES = 1_500_000;

/** Makes sure the workspace's graph has a version row, so a copy of it has something to be at. */
async function ensureHead(workspaceId: number): Promise<void> {
  await getDb().execute(sql`INSERT IGNORE INTO ${graphVersions} (workspaceId, version, epoch) VALUES (${workspaceId}, 0, UUID())`);
}

/** What the copy says it holds. */
export async function copyMeta(engine: CopyEngine): Promise<CopyMeta | null> {
  return readCopyMeta((await engine.query(META_QUERY)).results);
}

/**
 * Brings `engine`'s copy of workspace `workspaceId`'s graph to MySQL's current
 * version: nothing if it is there; the subjects changed since, if it can catch
 * up; otherwise a rebuild. Throws CopyTakenOver if another writer took the
 * copy over meanwhile: that writer brings it up to date.
 */
export async function catchUp(workspaceId: number, engine: CopyEngine, opts: { maxBytes?: number } = {}): Promise<CatchUp> {
  await ensureHead(workspaceId);
  const copy = await copyMeta(engine);
  const writer = randomUUID();
  const outcome = await inSnapshot(async (tx): Promise<CatchUp> => {
    const head = (await readGraphHead(tx, workspaceId))!;
    const reason = rebuildReason(copy, head);
    if (reason || !copy) return rebuild(tx, workspaceId, engine, head, reason ?? "it holds no version");
    if (copy.version === head.version) return { kind: "current", version: head.version };

    const changes = (await readGraphChanges(tx, workspaceId, copy.version))!;
    if (changes.everything) return rebuild(tx, workspaceId, engine, head, rebuildReason(copy, head, true)!);
    const { prefixMap, subjects } = renderChanges(changes);
    const requests = planUpdates({ prefixMap, subjects, from: copy.version, to: head.version, writer, maxBytes: opts.maxBytes ?? UPDATE_REQUEST_BYTES });
    for (const request of requests) {
      try {
        await engine.update(request);
      } catch (err) {
        // Refused by the fence, or failed for a reason of its own: which, the copy says.
        const now = await copyMeta(engine).catch(() => null);
        if (now && (now.writer !== writer || now.version !== copy.version)) {
          throw new CopyTakenOver(`another writer took the copy of workspace ${workspaceId} over (it is at version ${now.version})`);
        }
        throw err;
      }
    }
    return { kind: "caught-up", from: copy.version, version: head.version, subjects: subjects.length, requests: requests.length };
  });
  await recordProjected(workspaceId, outcome.version);
  return outcome;
}

/**
 * Rebuilds the copy from nothing, from `tx`'s snapshot at `head`: empties it,
 * loads every subject, then writes its version and epoch, last, so a copy cut
 * off mid-load holds no version and is rebuilt again.
 */
async function rebuild(
  tx: Parameters<Parameters<typeof inSnapshot>[0]>[0],
  workspaceId: number,
  engine: CopyEngine,
  head: GraphHead,
  reason: string,
): Promise<CatchUp> {
  await engine.reset();
  const schema = await readGraphSchema(tx, workspaceId);
  const prefixMap = buildPrefixMap(schema.modules);
  const ranges = datatypeRanges(schema.properties);
  const prefixOfModule = modulePrefixes(schema.modules);
  async function* subjects(): AsyncGenerator<TurtleSubject> {
    yield* schemaSubjects(schema, prefixMap);
    for await (const page of readGraphPages(tx, workspaceId)) {
      yield* knowledgeGraphSubjects([...page.nodes, ...page.targets], page.edges, prefixMap, ranges, prefixOfModule).slice(0, page.nodes.length);
    }
  }
  const triples = await engine.load(prefixMap, subjects());
  await engine.update(rebuiltMeta(head.version, head.epoch));
  return { kind: "rebuilt", version: head.version, reason, triples };
}
