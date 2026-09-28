import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  ontologyModules,
  ontologyClasses,
  ontologyProperties,
  kgNodes,
  kgEdges,
} from "@db/schema";
import { getDb } from "../queries/connection";
import {
  buildPrefixMap,
  datatypeRanges,
  moduleToTurtle,
  knowledgeGraphToTurtle,
  modulePrefixes,
} from "./rdfBridge";
import { EngineRequestError } from "./engineErrors";

export { EngineRequestError };

export type SemanticEngineHealth = {
  alive: boolean;
  version?: string;
  url: string;
  latencyMs?: number;
  error?: string;
};

export type ReasoningProfile = "rdfs" | "owl-rl" | "owl-rl-ext" | "owl-dl";

export type InferredSubClass = {
  child: string;
  ancestor: string;
  via?: string;
};

export type ReasoningResult = {
  ok: boolean;
  profile: string;
  initialTriples: number;
  finalTriples: number;
  inferredCount: number;
  iterations: number;
  sampleInferences: string[];
  inferredSubClassOf: InferredSubClass[];
  consistent: boolean;
  issues: string[];
  warnings: string[];
  durationMs: number;
  engineVersion: string;
  error?: string;
};

export type ShaclViolation = {
  constraint: string;
  focusNode: string;
  path?: string;
  severity?: "Violation" | "Warning" | "Info";
  message?: string;
  value?: string;
};

export type ShaclValidationResult = {
  conforms: boolean;
  focusNodes: number;
  violationCount: number;
  violations: ShaclViolation[];
  raw?: unknown;
  error?: string;
};

export type SparqlResult = {
  variables: string[];
  results: Record<string, string>[];
};

/** A non-2xx answer: the request's fault (4xx, but a timeout or rate limit) or the engine's. */
function httpFailure(what: string, res: Response): Error {
  const message = `${what}: HTTP ${res.status} ${res.statusText}`.trim();
  return res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429 ? new EngineRequestError(message) : new Error(message);
}

/**
 * Runs a task while no other process that uses the same engine runs one (see
 * shareWith). The task is handed a signal that aborts when it must stop: the
 * lock lost, `signal` aborted, or the task held the engine too long.
 */
export type EngineLock = <T>(task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal) => Promise<T>;

/** An exclusive() task, as the engine requests made in it see it. */
type EngineTask = {
  /** Aborts when the task must stop. From then on the task sends the engine nothing. */
  signal: AbortSignal;
  /** Requests the task has sent that have not yet answered or timed out. */
  inFlight: Set<Promise<unknown>>;
  /** A request the task sent timed out: the engine may still be at it. */
  abandoned: boolean;
  /** The task is over. Work it left behind (a timer, say) still sees it, and must not count as it. */
  ended: boolean;
};

/** The exclusive() task a call runs in. */
const currentTask = new AsyncLocalStorage<EngineTask>();

/** The task a call runs in, unless that task is over. */
const runningTask = () => {
  const task = currentTask.getStore();
  return task && !task.ended ? task : undefined;
};

/** The signal of a task nothing tells to stop. */
const NEVER = new AbortController().signal;

/**
 * How long a task tries, after a request of its timed out, to have the engine
 * answer one more query before it lets the engine go. A best effort: the
 * engine goes on with a request its client gave up on, and an answer to a
 * later one says little about when that ends. The checks whose results
 * matter look for its effects themselves (checkLoaded).
 */
const SETTLE_MS = 30_000;

/**
 * The store changed while a task used it: another writer was at it, a
 * request an earlier task gave up on, say. What the task saw is not what it
 * loaded. A later try may find the store undisturbed.
 */
export class EngineInterference extends Error {}

/** Resolves once `p` settles, or rejects as soon as `signal` aborts. */
function untilSettled(p: Promise<unknown>, signal?: AbortSignal): Promise<void> {
  if (!signal) return p.then(
    () => undefined,
    () => undefined,
  );
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    p.catch(() => undefined).finally(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
  });
}

export class SemanticEngineClient {
  private baseUrl: string;
  private token?: string;
  private binaryPath?: string;
  // The engine holds one dataset for the whole process. `queue` serialises the
  // compound operations on it (see exclusive); `loadedWorkspaceId` records whose
  // complete graph the store holds, or null once it holds anything else.
  private queue: Promise<unknown> = Promise.resolve();
  private loadedWorkspaceId: number | null = null;
  // Held around each exclusive() task when other processes use this engine too.
  private sharedLock: EngineLock | null = null;

  constructor() {
    this.baseUrl =
      process.env.OPEN_ONTOLOGIES_URL ||
      `http://127.0.0.1:${process.env.OPEN_ONTOLOGIES_PORT || "8085"}`;
    this.token = process.env.OPEN_ONTOLOGIES_TOKEN;
    this.binaryPath = this.resolveBinaryPath();
  }

  public getUrl(): string {
    return this.baseUrl;
  }

  /**
   * Runs `task` with the engine to itself. Because the store holds one dataset,
   * a clear → load → query/validate/reason sequence must not interleave with
   * another request's clear, so every such sequence runs through here.
   *
   * It serialises within this process, and across processes too once
   * shareWith() has given it a lock they all take. `signal` calls off the wait
   * for a turn, and stops the task: from then on, as when the shared lock is
   * lost, the task sends the engine nothing more (see runTask).
   *
   * Not re-entrant: a task that asked for its own turn would wait for ever,
   * holding the lock. Called from inside a task, it throws.
   */
  public exclusive<T>(task: () => Promise<T>, opts: { signal?: AbortSignal } = {}): Promise<T> {
    if (runningTask()) return Promise.reject(new Error("exclusive() is not re-entrant: this task already has the engine"));
    const { signal } = opts;
    const lock = this.sharedLock;
    const previous = this.queue;
    const run = (async () => {
      await untilSettled(previous, signal);
      signal?.throwIfAborted();
      if (!lock) return this.runTask(task, signal ?? NEVER);
      return lock((held) => {
        // Another process may have loaded its own graph since this one's
        // last task, so what the store holds is no longer known.
        this.loadedWorkspaceId = null;
        return this.runTask(task, held);
      }, signal);
    })();
    // The next task waits for this one, and for the one before it even when
    // this one stopped waiting early. Settled to nothing: the settled values
    // would hold every task's result, each chained to the one before it, for
    // the life of the process.
    this.queue = Promise.allSettled([previous, run]).then(() => undefined);
    return run;
  }

  /**
   * Runs `task` as the engine's current task, and ends only once the engine
   * has done what the task asked of it, as far as the client can tell. The
   * engine goes on with a request its client gives up on, so ending sooner
   * would let the next task (or the next holder of the shared lock) clear and
   * load the store while the engine still writes this task's data into it.
   * So a task told to stop sends nothing more, but every request it has sent
   * answers or times out first, awaited or not; and after one timed out, it
   * tries, for at most SETTLE_MS, to have the engine answer one more query.
   */
  private async runTask<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    const state: EngineTask = { signal, inFlight: new Set(), abandoned: false, ended: false };
    try {
      return await currentTask.run(state, task);
    } finally {
      // Each ends by its own timeout.
      await Promise.allSettled([...state.inFlight]);
      if (state.abandoned) await this.settle();
      state.ended = true;
    }
  }

  /** Tries, for at most SETTLE_MS, to have the engine answer a query, a second apart. */
  private async settle(): Promise<void> {
    const deadline = Date.now() + SETTLE_MS;
    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) return;
      const answered = await fetch(`${this.baseUrl}/api/query`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ query: "ASK { ?s ?p ?o }" }),
        signal: AbortSignal.timeout(left),
      }).then(
        async (res) => {
          await res.arrayBuffer();
          return res.ok;
        },
        () => false,
      );
      if (answered) return;
      await new Promise((r) => setTimeout(r, Math.min(1_000, Math.max(0, deadline - Date.now()))));
    }
  }

  /** The signal of the exclusive() task this call runs in, if any: it aborts when the task must stop. */
  public currentTaskSignal(): AbortSignal | undefined {
    return runningTask()?.signal;
  }

  /**
   * Sends one request to the engine, bounded by its own timeout. In a task
   * told to stop, it sends nothing and throws the reason. A request already
   * sent is never cut short by the task's signal: the engine would go on
   * with it regardless. The task keeps it until it answers (see runTask), and
   * one that times out marks the task.
   */
  private send(path: string, init: { method: "GET" | "POST"; body?: string }, timeoutMs: number): Promise<Response> {
    const task = runningTask();
    try {
      task?.signal.throwIfAborted();
    } catch (err) {
      return Promise.reject(err);
    }
    const signal = AbortSignal.timeout(timeoutMs);
    const sending = (async () => {
      try {
        return await fetch(`${this.baseUrl}${path}`, { ...init, headers: this.getHeaders(), signal });
      } catch (err) {
        if (task && signal.aborted) task.abandoned = true;
        throw err;
      }
    })();
    if (task) {
      task.inFlight.add(sending);
      sending.then(
        () => task.inFlight.delete(sending),
        () => task.inFlight.delete(sending),
      );
    }
    return sending;
  }

  /** How many triples the store's default graph holds. */
  public async countTriples(): Promise<number> {
    const { results } = await this.querySparql("SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }");
    const n = Number(/\d+/.exec(String(results[0]?.n ?? ""))?.[0]);
    if (!Number.isSafeInteger(n)) throw new Error(`the engine counted '${String(results[0]?.n)}' triples`);
    return n;
  }

  /**
   * Empties the store, has `load` fill it (it answers how many triples it
   * loaded), and runs `check` on it: a check that only reads, such as SHACL
   * validation. Its result is refused with EngineInterference if the store
   * held anything else at a moment it could tell: more triples than were
   * loaded, none when some were, or a count that moved while the check ran.
   * A request an earlier task gave up on, still writing, shows so. Call inside
   * exclusive().
   */
  public async checkLoaded<T>(load: () => Promise<number>, check: () => Promise<T>): Promise<T> {
    await this.clearStore();
    const loaded = await load();
    const before = await this.countTriples();
    const result = await check();
    const after = await this.countTriples();
    if (before > loaded || (loaded > 0 && before === 0) || after !== before) {
      throw new EngineInterference(`the engine's store changed under the check: ${loaded} triples loaded, ${before} there before it ran, ${after} after`);
    }
    return result;
  }

  /**
   * Declares that other processes use this engine too, and gives the lock they
   * all take around each exclusive() task (a worker's replicas share one
   * engine; services/engineLock.ts). With it, a task never trusts that the
   * store still holds what an earlier one loaded, and sends the engine nothing
   * more once the lock is lost.
   */
  public shareWith(lock: EngineLock | null): void {
    this.sharedLock = lock;
  }

  /**
   * Makes the store hold this workspace's complete graph, syncing unless it
   * already does. Call inside exclusive(). Skipping the sync can serve data as
   * old as the last sync, but never another workspace's.
   */
  public async ensureWorkspaceLoaded(workspaceId: number): Promise<void> {
    if (this.loadedWorkspaceId === workspaceId) return;
    await this.syncWorkspace(workspaceId);
  }

  /**
   * Resolves the open-ontologies executable path if present locally.
   */
  private resolveBinaryPath(): string | undefined {
    if (process.env.OPEN_ONTOLOGIES_BIN && fs.existsSync(process.env.OPEN_ONTOLOGIES_BIN)) {
      return process.env.OPEN_ONTOLOGIES_BIN;
    }
    const candidates = [
      path.resolve(process.cwd(), "bin", "open-ontologies.exe"),
      path.resolve(process.cwd(), "app", "bin", "open-ontologies.exe"),
      path.resolve(process.cwd(), "..", "bin", "open-ontologies.exe"),
      path.resolve(process.cwd(), "bin", "open-ontologies"),
      path.resolve(process.cwd(), "app", "bin", "open-ontologies"),
      path.resolve(process.cwd(), "..", "bin", "open-ontologies"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return undefined;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  /**
   * Checks the engine liveness probe at /health.
   */
  public async checkHealth(): Promise<SemanticEngineHealth> {
    const start = Date.now();
    try {
      const res = await this.send("/health", { method: "GET" }, 2000);
      if (!res.ok) {
        return {
          alive: false,
          url: this.baseUrl,
          latencyMs: Date.now() - start,
          error: `HTTP ${res.status}: ${res.statusText}`,
        };
      }
      const data = (await res.json()) as { status: string; version: string };
      return {
        alive: data.status === "ok",
        version: data.version,
        url: this.baseUrl,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        alive: false,
        url: this.baseUrl,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Ensures the open-ontologies daemon is running. If not running and a binary is found,
   * attempts to launch the daemon on the configured port.
   */
  public async ensureEngineRunning(): Promise<boolean> {
    const health = await this.checkHealth();
    if (health.alive) return true;

    // No binary to start, or a task that must stop: nothing is spawned.
    if (!this.binaryPath || this.currentTaskSignal()?.aborted) {
      return false;
    }

    try {
      const port = new URL(this.baseUrl).port || "8085";
      const host = new URL(this.baseUrl).hostname || "127.0.0.1";

      const child = spawn(
        this.binaryPath,
        ["daemon", "start", "--host", host, "--port", port],
        {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        },
      );
      child.unref();

      // Poll up to 4 seconds for liveness
      for (let i = 0; i < 16; i++) {
        if (this.currentTaskSignal()?.aborted) return false;
        await new Promise((r) => setTimeout(r, 250));
        const check = await this.checkHealth();
        if (check.alive) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Loads raw Turtle data directly into the engine's Oxigraph graph store.
   */
  public async loadTurtle(turtle: string, baseIri?: string): Promise<{ ok: boolean; triplesLoaded: number }> {
    this.loadedWorkspaceId = null;
    await this.ensureEngineRunning();
    const res = await this.send("/api/load-turtle", { method: "POST", body: JSON.stringify({ turtle, base: baseIri }) }, 15000);
    if (!res.ok) throw httpFailure("Failed to load Turtle", res);
    const data = (await res.json()) as { ok?: boolean; triples_loaded?: number; error?: string };
    if (data.error) throw new EngineRequestError(`Oxigraph load error: ${data.error}`);
    return { ok: true, triplesLoaded: data.triples_loaded ?? 0 };
  }

  /**
   * Clears the in-memory Oxigraph triple store. Throws if the engine refuses:
   * loading on top of a store that still holds another graph would mix them.
   */
  public async clearStore(): Promise<boolean> {
    this.loadedWorkspaceId = null;
    await this.ensureEngineRunning();
    const res = await this.send("/api/batch", { method: "POST", body: JSON.stringify([{ command: "clear", args: [] }]) }, 5000);
    if (!res.ok) {
      throw new Error(`Failed to clear the engine store: HTTP ${res.status}`);
    }
    return true;
  }

  /**
   * Executes a SPARQL 1.1 SELECT query.
   */
  public async querySparql(sparqlQuery: string): Promise<SparqlResult> {
    await this.ensureEngineRunning();
    const res = await this.send("/api/query", { method: "POST", body: JSON.stringify({ query: sparqlQuery }) }, 30000);
    if (!res.ok) {
      throw new Error(`SPARQL query failed: HTTP ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as {
      variables?: string[];
      results?: Record<string, string>[];
      error?: string;
    };
    if (data.error) throw new Error(`SPARQL error: ${data.error}`);
    return {
      variables: data.variables ?? [],
      results: data.results ?? [],
    };
  }

  /**
   * Executes a SPARQL 1.1 UPDATE query.
   */
  public async updateSparql(sparqlUpdate: string): Promise<{ ok: boolean; affected: number }> {
    this.loadedWorkspaceId = null;
    await this.ensureEngineRunning();
    const res = await this.send("/api/update", { method: "POST", body: JSON.stringify({ query: sparqlUpdate }) }, 30000);
    if (!res.ok) {
      throw new Error(`SPARQL update failed: HTTP ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { ok?: boolean; affected?: number; error?: string };
    if (data.error) throw new Error(`SPARQL update error: ${data.error}`);
    return { ok: true, affected: data.affected ?? 0 };
  }

  /**
   * Runs the W3C SHACL validator against the currently loaded graph.
   *
   * The engine accepts shapes only as a file path, which it reads from its own
   * filesystem. Run as separate containers, the app and engine therefore need
   * a directory they both see: compose mounts one volume at /exchange in each
   * and sets SHACL_EXCHANGE_DIR. When both run on one host, the OS temp
   * directory already is that shared place.
   */
  public async validateShacl(shapesTurtle: string): Promise<ShaclValidationResult> {
    await this.ensureEngineRunning();

    type BatchResp = Array<{
      command: string;
      result?: {
        conforms?: boolean;
        focus_nodes?: number;
        violation_count?: number;
        violations?: Array<{
          constraint?: string;
          focus_node?: string;
          path?: string;
          severity?: "Violation" | "Warning" | "Info";
          message?: string;
          value?: string;
        }>;
        error?: string;
      };
      error?: string;
    }>;

    const exchangeDir = process.env.SHACL_EXCHANGE_DIR || os.tmpdir();
    const shapesFile = path.join(exchangeDir, `ontos-shacl-${randomUUID()}.ttl`);
    fs.writeFileSync(shapesFile, shapesTurtle, "utf-8");

    try {
      const res = await this.send("/api/batch", { method: "POST", body: JSON.stringify([{ command: "shacl", args: [shapesFile] }]) }, 30000);
      if (!res.ok) throw httpFailure("SHACL validation request failed", res);

      const batch = (await res.json()) as BatchResp;
      const shaclRes = batch[0]?.result;

      const refused = shaclRes?.error || batch[0]?.error;
      if (refused) throw new EngineRequestError(refused);
      if (!shaclRes) throw new Error("SHACL validation failed: the engine returned no result");

      const violations: ShaclViolation[] = (shaclRes.violations ?? []).map((v) => ({
        constraint: v.constraint ?? "unknown",
        focusNode: v.focus_node ?? "",
        path: v.path,
        severity: v.severity ?? "Violation",
        message: v.message,
        value: v.value,
      }));

      return {
        conforms: shaclRes.conforms ?? false,
        focusNodes: shaclRes.focus_nodes ?? 0,
        violationCount: shaclRes.violation_count ?? violations.length,
        violations,
        raw: shaclRes,
      };
    } finally {
      try {
        fs.unlinkSync(shapesFile);
      } catch {
        // already gone
      }
    }
  }

  /**
   * Executes the native OWL/RDFS reasoner over the loaded graph and retrieves inferences.
   */
  public async runReasoning(profile: ReasoningProfile = "owl-rl"): Promise<ReasoningResult> {
    const started = Date.now();
    // Reasoning materialises inferred triples into the store.
    this.loadedWorkspaceId = null;
    await this.ensureEngineRunning();

    const health = await this.checkHealth();
    const engineVersion = health.version || "open-ontologies";

    const res = await this.send("/api/batch", { method: "POST", body: JSON.stringify([{ command: "reason", args: ["--profile", profile] }]) }, 30000);

    if (!res.ok) {
      throw new Error(`Reasoning request failed: HTTP ${res.status}`);
    }

    type ReasonBatch = Array<{
      command: string;
      result?: {
        initial_triples?: number;
        final_triples?: number;
        inferred_count?: number;
        iterations?: number;
        profile_used?: string;
        sample_inferences?: string[];
        error?: string;
      };
      error?: string;
    }>;

    const batch = (await res.json()) as ReasonBatch;
    const item = batch[0]?.result;
    if (!item || item.error) {
      throw new Error(item?.error || batch[0]?.error || "Reasoning execution failed");
    }

    // Query inferred subClassOf relationships from the reasoned graph
    const sparql = `
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX owl: <http://www.w3.org/2002/07/owl#>
      SELECT DISTINCT ?child ?ancestor WHERE {
        ?child rdfs:subClassOf ?ancestor .
        FILTER(?child != ?ancestor && ?ancestor != owl:Thing)
      }
    `;

    let inferredSubClassOf: InferredSubClass[] = [];
    try {
      const qRes = await this.querySparql(sparql);
      inferredSubClassOf = qRes.results.map((r) => ({
        child: r.child?.replace(/^<|>$/g, "") ?? "",
        ancestor: r.ancestor?.replace(/^<|>$/g, "") ?? "",
      }));
    } catch (err) {
      // A task told to stop stops: an empty list would read as a result.
      if (this.currentTaskSignal()?.aborted) throw err;
      // If SPARQL query fails, inferred list stays empty
    }

    // Check for inconsistent / unsatisfiable classes (subclass of owl:Nothing)
    const issues: string[] = [];
    const warnings: string[] = [];
    try {
      const checkInconsistent = await this.querySparql(`
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        PREFIX owl: <http://www.w3.org/2002/07/owl#>
        SELECT ?c WHERE {
          ?c rdfs:subClassOf owl:Nothing .
        }
      `);
      if (checkInconsistent.results.length > 0) {
        for (const row of checkInconsistent.results) {
          issues.push(`Unsatisfiable/inconsistent class detected: ${row.c}`);
        }
      }
    } catch (err) {
      // As above: "no issues" from a stopped task would read as consistent.
      if (this.currentTaskSignal()?.aborted) throw err;
    }

    const durationMs = Date.now() - started;

    return {
      ok: issues.length === 0,
      profile: item.profile_used ?? profile,
      initialTriples: item.initial_triples ?? 0,
      finalTriples: item.final_triples ?? 0,
      inferredCount: item.inferred_count ?? 0,
      iterations: item.iterations ?? 0,
      sampleInferences: item.sample_inferences ?? [],
      inferredSubClassOf,
      consistent: issues.length === 0,
      issues,
      warnings,
      durationMs,
      engineVersion,
    };
  }

  /**
   * Syncs an entire Ontos workspace into the semantic engine:
   * 1. Clears engine store
   * 2. Serializes active modules to Turtle
   * 3. Serializes active KG nodes and edges to Turtle
   * 4. Loads both into the engine's Oxigraph store
   *
   * Call inside exclusive(), together with whatever reads the synced store.
   */
  public async syncWorkspace(workspaceId: number): Promise<{
    classesLoaded: number;
    propertiesLoaded: number;
    instancesLoaded: number;
    triplesLoaded: number;
  }> {
    const db = getDb();
    const modules = await db
      .select()
      .from(ontologyModules)
      .where(eq(ontologyModules.workspaceId, workspaceId));

    if (modules.length === 0) {
      await this.clearStore();
      this.loadedWorkspaceId = workspaceId;
      return { classesLoaded: 0, propertiesLoaded: 0, instancesLoaded: 0, triplesLoaded: 0 };
    }

    const moduleIds = modules.map((m) => m.id);
    const classes = await db
      .select()
      .from(ontologyClasses)
      .where(and(inArray(ontologyClasses.moduleId, moduleIds), eq(ontologyClasses.deprecated, false)));

    const properties = await db
      .select()
      .from(ontologyProperties)
      .where(inArray(ontologyProperties.moduleId, moduleIds));

    const nodes = await db
      .select()
      .from(kgNodes)
      .where(and(eq(kgNodes.workspaceId, workspaceId), isNull(kgNodes.deletedAt)));

    const edges = await db
      .select()
      .from(kgEdges)
      .where(and(eq(kgEdges.workspaceId, workspaceId), isNull(kgEdges.deletedAt)));

    await this.clearStore();

    const prefixMap = buildPrefixMap(modules);

    let totalTriples = 0;

    // Load each module's schema
    for (const mod of modules) {
      const modClasses = classes.filter((c) => c.moduleId === mod.id);
      const modProps = properties.filter((p) => p.moduleId === mod.id);
      const ttl = moduleToTurtle(mod, modClasses, modProps, prefixMap);
      const res = await this.loadTurtle(ttl);
      totalTriples += res.triplesLoaded;
    }

    // Load instances
    if (nodes.length > 0) {
      const kgTtl = knowledgeGraphToTurtle(nodes, edges, prefixMap, datatypeRanges(properties), modulePrefixes(modules));
      const res = await this.loadTurtle(kgTtl);
      totalTriples += res.triplesLoaded;
    }

    this.loadedWorkspaceId = workspaceId;
    return {
      classesLoaded: classes.filter((c) => moduleIds.includes(c.moduleId)).length,
      propertiesLoaded: properties.filter((p) => moduleIds.includes(p.moduleId)).length,
      instancesLoaded: nodes.length,
      triplesLoaded: totalTriples,
    };
  }
}

export const semanticEngine = new SemanticEngineClient();
