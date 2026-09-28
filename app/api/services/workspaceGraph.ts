import { Readable } from "node:stream";
import { gt } from "drizzle-orm";
import { graphVersions } from "@db/schema";
import { getDb, openConnection } from "../queries/connection";
import { env } from "../lib/env";
import { lockName, LockUnavailable, withNamedLock, type LockConnection } from "../lib/namedLock";
import { engineIdentity } from "./engineLock";
import { EngineHostClient, EngineHostRefusal, EngineHostUnavailable } from "./engineHostClient";
import { catchUp, copyMeta, CopyTakenOver, type CatchUp, type CopyEngine } from "./graphCopy";
import { readGraphHead } from "./graphSnapshot";
import { serializePrefixes, subjectToTurtle, type TurtleSubject } from "./rdfBridge";
import type { ShaclReport } from "./engineHost/types";
import { semanticEngine, type ShaclValidationResult, type ShaclViolation, type SparqlResult } from "./semanticEngine";

/**
 * Each workspace's graph, read from a persistent copy of its own in the
 * engine host (engineHost.ts), brought up to date from change capture
 * (graphCopy.ts) rather than cleared and reloaded for every read.
 *
 * A fresh read (the default) answers at MySQL's current version: it compares
 * the copy's version with MySQL's, and when the copy is behind it catches it
 * up first, under the workspace's engine lock, which every process takes. A
 * write committed before the read began is therefore in the answer, whichever
 * replica wrote it. The worker catches copies up in the background, so a read
 * seldom waits.
 *
 * Without ENGINE_HOST_URL, the app keeps its one engine and loads the
 * workspace into it for each read, as before.
 */

/** A read's version: the MySQL graph version its answer holds, or null from the one engine. */
export type GraphAnswer = SparqlResult & { version: number | null };

/** The workspace's copy is not ready in time: another process is catching it up, or the host is away. Try again shortly. */
export class GraphNotReady extends Error {}

/** How long a read waits for the workspace's engine lock before it answers GraphNotReady. */
export const READ_WAIT_SECONDS = 10;
/** How long a background catch-up waits for it: briefly, since another process holding it is doing the same work. */
export const BACKGROUND_WAIT_SECONDS = 1;
/** How long one catch-up may hold it: a rebuild of a large workspace takes minutes. */
export const CATCH_UP_HOLD_MS = 15 * 60_000;
/** How long a copy's version, once read, is trusted without reading it again. */
const KNOWN_FOR_MS = 1_000;

/** The lock a workspace's copy is caught up under, the same in every process of one deployment. */
export function workspaceEngineLockName(databaseUrl: string, hostUrl: string, workspaceId: number, explicitKey?: string): string {
  let database = databaseUrl;
  try {
    database = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
  } catch {
    // Not a URL: the whole string stands for the database.
  }
  return lockName("wsengine", `${database}\n${engineIdentity(hostUrl, explicitKey)}\nws:${workspaceId}`);
}

/**
 * A workspace's copy in the engine host. Writes name the incarnation of the
 * store they were prepared for, so none lands in a store reset since: a
 * rebuilder that lost its turn cannot append to a newer one.
 */
export function hostedCopy(client: EngineHostClient, workspaceId: number): CopyEngine {
  let incarnation: string | null = null;
  const current = async () => {
    if (incarnation) return incarnation;
    incarnation = (await client.status(workspaceId)).incarnation;
    if (!incarnation) {
      // A store not yet opened has none: a query opens it.
      await client.query(workspaceId, "ASK { ?s ?p ?o }");
      incarnation = (await client.status(workspaceId)).incarnation;
    }
    if (!incarnation) throw new GraphNotReady(`the engine host has no store open for workspace ${workspaceId}`);
    return incarnation;
  };
  const select = async (sparql: string): Promise<SparqlResult> => {
    const { answer } = await client.query(workspaceId, sparql);
    if (!("variables" in answer)) throw new EngineHostRefusal(422, "not_select", "The engine did not answer the query with rows.");
    return { variables: answer.variables, results: answer.results };
  };
  return {
    query: select,
    async update(sparql) {
      await client.update(workspaceId, sparql, { incarnation: await current() });
    },
    async reset() {
      incarnation = (await client.reset(workspaceId)).incarnation;
    },
    async load(prefixMap: Map<string, string>, subjects: AsyncIterable<TurtleSubject>) {
      async function* turtle(): AsyncGenerator<string> {
        yield serializePrefixes(prefixMap);
        for await (const s of subjects) yield "\n" + subjectToTurtle(s);
      }
      await client.load(workspaceId, Readable.from(turtle()), { incarnation: await current(), format: "turtle" });
      const { results } = await select("SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }");
      return Number(/\d+/.exec(String(results[0]?.n ?? ""))?.[0] ?? NaN);
    },
  };
}

type Known = { version: number; epoch: string | null; at: number };

export class WorkspaceGraphs {
  /** Each workspace's catch-up running in this process: reads that need one share it. */
  private readonly running = new Map<number, Promise<CatchUp>>();
  /** What each copy last said it holds, and when. */
  private readonly known = new Map<number, Known>();

  private readonly client: EngineHostClient;
  private readonly opts: { connect: () => Promise<LockConnection>; databaseUrl: string; hostUrl: string; lockKey?: string };

  constructor(client: EngineHostClient, opts: WorkspaceGraphs["opts"]) {
    this.client = client;
    this.opts = opts;
  }

  /**
   * Brings the workspace's copy to MySQL's current version, under its lock.
   * A catch-up already running here is joined. Throws GraphNotReady when the
   * lock stays held elsewhere for `waitSeconds`, or another writer takes the
   * copy over: that one brings it up to date.
   */
  catchUp(workspaceId: number, opts: { waitSeconds: number; signal?: AbortSignal }): Promise<CatchUp> {
    const joined = this.running.get(workspaceId);
    if (joined) return joined;
    const name = workspaceEngineLockName(this.opts.databaseUrl, this.opts.hostUrl, workspaceId, this.opts.lockKey);
    const run = withNamedLock(this.opts.connect, name, { waitSeconds: opts.waitSeconds, holdMs: CATCH_UP_HOLD_MS, signal: opts.signal }, () =>
      catchUp(workspaceId, hostedCopy(this.client, workspaceId)),
    )
      .then((outcome) => {
        this.known.delete(workspaceId);
        return outcome;
      })
      .catch((err: unknown) => {
        this.known.delete(workspaceId);
        if (err instanceof LockUnavailable || err instanceof CopyTakenOver) {
          throw new GraphNotReady(`the graph of workspace ${workspaceId} is being brought up to date elsewhere: ${err.message}`);
        }
        throw err;
      })
      .finally(() => this.running.delete(workspaceId));
    this.running.set(workspaceId, run);
    return run;
  }

  /**
   * Answers a SPARQL SELECT on the workspace's graph. Fresh (the default), the
   * answer holds MySQL's current version: the copy is caught up first when it
   * is behind. Not fresh, it answers at whatever version the copy holds, and
   * says which.
   */
  async query(workspaceId: number, sparql: string, opts: { fresh?: boolean } = {}): Promise<GraphAnswer> {
    let version: number;
    if (opts.fresh ?? true) version = await this.fresh(workspaceId);
    else version = (await copyMeta(hostedCopy(this.client, workspaceId)))?.version ?? 0;
    const { answer } = await this.client.query(workspaceId, sparql);
    if (!("variables" in answer)) throw new EngineHostRefusal(422, "not_select", "Only queries that answer rows are served here.");
    return { variables: answer.variables, results: answer.results, version };
  }

  /** Makes sure the copy holds MySQL's current version, and answers it. */
  private async fresh(workspaceId: number): Promise<number> {
    const head = await readGraphHead(getDb(), workspaceId);
    if (head) {
      const known = this.known.get(workspaceId);
      if (known && known.version === head.version && known.epoch === head.epoch && Date.now() - known.at < KNOWN_FOR_MS) return head.version;
      const meta = await copyMeta(hostedCopy(this.client, workspaceId));
      if (meta && meta.version === head.version && meta.epoch === head.epoch) {
        this.known.set(workspaceId, { version: meta.version, epoch: meta.epoch, at: Date.now() });
        return head.version;
      }
    }
    return (await this.catchUp(workspaceId, { waitSeconds: READ_WAIT_SECONDS })).version;
  }

  /**
   * Catches up every workspace whose copy is behind MySQL, one at a time,
   * leaving those another process is already catching up. The worker runs it
   * every few seconds. Answers how many it brought up to date.
   */
  async catchUpBehind(opts: { signal?: AbortSignal; limit?: number } = {}): Promise<number> {
    const rows = await getDb()
      .select({ workspaceId: graphVersions.workspaceId })
      .from(graphVersions)
      .where(gt(graphVersions.version, graphVersions.projectedVersion))
      .orderBy(graphVersions.workspaceId)
      .limit(Math.max(1, Math.min(opts.limit ?? 50, 500)));
    let done = 0;
    for (const { workspaceId } of rows) {
      if (opts.signal?.aborted) break;
      try {
        await this.catchUp(workspaceId, { waitSeconds: BACKGROUND_WAIT_SECONDS, signal: opts.signal });
        done++;
      } catch (err) {
        if (!(err instanceof GraphNotReady)) console.warn(`[graph] workspace ${workspaceId} could not be brought up to date: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return done;
  }
}

/**
 * How a read that failed answers: 400 when the query itself was refused (the
 * engine could not parse it, say), 503 when the graph could not be read just
 * now (its copy not ready in time, the host away or its store unusable).
 * Anything else is rethrown: a defect, not an answer.
 */
export function graphReadFailure(err: unknown): { status: 400 | 503; message: string; retryAfterSeconds?: number } {
  if (err instanceof EngineHostRefusal && (err.status === 400 || err.status === 422)) {
    return { status: 400, message: `SPARQL execution failed: ${err.message}` };
  }
  if (err instanceof GraphNotReady || err instanceof EngineHostUnavailable || err instanceof EngineHostRefusal || err instanceof LockUnavailable) {
    const retryAfterSeconds = err instanceof EngineHostUnavailable && err.retryAfterMs ? Math.max(1, Math.ceil(err.retryAfterMs / 1000)) : 2;
    return { status: 503, message: `The workspace's graph could not be read just now: ${err.message}`, retryAfterSeconds };
  }
  throw err;
}

let host: { client: EngineHostClient; graphs: WorkspaceGraphs } | null | undefined;

function engineHost() {
  if (host === undefined) {
    const hostUrl = process.env.ENGINE_HOST_URL?.trim();
    if (!hostUrl) {
      host = null;
    } else {
      const client = EngineHostClient.fromEnv();
      const graphs = new WorkspaceGraphs(client, { connect: openConnection, databaseUrl: env.databaseUrl, hostUrl, lockKey: process.env.ENGINE_LOCK_KEY });
      host = { client, graphs };
    }
  }
  return host;
}

/** The deployment's workspace graphs in the engine host, or null when no host is configured (ENGINE_HOST_URL). */
export function workspaceGraphs(): WorkspaceGraphs | null {
  return engineHost()?.graphs ?? null;
}

/** An engine's SHACL report as the app reads one. `conforms: null` (no shape targeted anything) conforms, with no focus nodes. */
export function shaclResultOf(report: ShaclReport): ShaclValidationResult {
  const violations: ShaclViolation[] = (report.violations ?? []).map((v) => ({
    constraint: v.constraint ?? "unknown",
    focusNode: v.focus_node ?? "",
    path: v.path,
    severity: v.severity ?? "Violation",
    message: v.message,
    value: v.value,
  }));
  return {
    conforms: report.conforms ?? violations.length === 0,
    focusNodes: report.focus_nodes ?? 0,
    violationCount: report.violation_count ?? violations.length,
    violations,
    raw: report,
  };
}

/**
 * Validates `subjects` against `shapes` on one of the engine host's scratch
 * engines, which holds nothing else for the check: a what-if check of data
 * not in the graph yet, an import's rows or an action's result. It needs no
 * lock, and nothing else can write into what it checks. Throws if no host is
 * configured.
 */
export async function scratchShacl(prefixMap: Map<string, string>, subjects: TurtleSubject[], shapes: string, signal?: AbortSignal): Promise<ShaclValidationResult> {
  const hosted = engineHost();
  if (!hosted) throw new Error("no engine host is configured (ENGINE_HOST_URL)");
  const data = [serializePrefixes(prefixMap), ...subjects.map(subjectToTurtle)].join("\n");
  const { report } = await hosted.client.scratchValidate({ data, shapes }, { signal });
  return shaclResultOf(report);
}

/**
 * A SPARQL SELECT on the workspace's graph, the way this deployment serves
 * it: from the workspace's copy in the engine host, fresh unless asked not to
 * be; or, with no host, from the one engine, loaded with the workspace first
 * (skipped when not fresh and it already holds it).
 */
export async function queryWorkspaceGraph(workspaceId: number, sparql: string, opts: { fresh?: boolean } = {}): Promise<GraphAnswer> {
  const hosted = workspaceGraphs();
  if (hosted) return hosted.query(workspaceId, sparql, opts);
  const result = await semanticEngine.exclusive(async () => {
    if (opts.fresh ?? true) await semanticEngine.syncWorkspace(workspaceId);
    else await semanticEngine.ensureWorkspaceLoaded(workspaceId);
    return semanticEngine.querySparql(sparql);
  });
  return { ...result, version: null };
}
