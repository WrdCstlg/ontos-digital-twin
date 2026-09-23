import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  moduleToTurtle,
  knowledgeGraphToTurtle,
} from "./rdfBridge";

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

class SemanticEngineClient {
  private baseUrl: string;
  private token?: string;
  private binaryPath?: string;

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
      const res = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(2000),
      });
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

    if (!this.binaryPath) {
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
    await this.ensureEngineRunning();
    const res = await fetch(`${this.baseUrl}/api/load-turtle`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ turtle, base: baseIri }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      throw new Error(`Failed to load Turtle: HTTP ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { ok?: boolean; triples_loaded?: number; error?: string };
    if (data.error) throw new Error(`Oxigraph load error: ${data.error}`);
    return { ok: true, triplesLoaded: data.triples_loaded ?? 0 };
  }

  /**
   * Clears the in-memory Oxigraph triple store.
   */
  public async clearStore(): Promise<boolean> {
    await this.ensureEngineRunning();
    const res = await fetch(`${this.baseUrl}/api/batch`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify([{ command: "clear", args: [] }]),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  }

  /**
   * Executes a SPARQL 1.1 SELECT query.
   */
  public async querySparql(sparqlQuery: string): Promise<SparqlResult> {
    await this.ensureEngineRunning();
    const res = await fetch(`${this.baseUrl}/api/query`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ query: sparqlQuery }),
      signal: AbortSignal.timeout(30000),
    });
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
    await this.ensureEngineRunning();
    const res = await fetch(`${this.baseUrl}/api/update`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ query: sparqlUpdate }),
      signal: AbortSignal.timeout(30000),
    });
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
      const res = await fetch(`${this.baseUrl}/api/batch`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify([{ command: "shacl", args: [shapesFile] }]),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        throw new Error(`SHACL validation request failed: HTTP ${res.status}`);
      }

      const batch = (await res.json()) as BatchResp;
      const shaclRes = batch[0]?.result;

      if (!shaclRes || shaclRes.error) {
        throw new Error(shaclRes?.error || batch[0]?.error || "SHACL validation failed");
      }

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
    await this.ensureEngineRunning();

    const health = await this.checkHealth();
    const engineVersion = health.version || "open-ontologies";

    const res = await fetch(`${this.baseUrl}/api/batch`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify([{ command: "reason", args: ["--profile", profile] }]),
      signal: AbortSignal.timeout(30000),
    });

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
    } catch {
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
    } catch {
      // ignore
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
      const kgTtl = knowledgeGraphToTurtle(nodes, edges, prefixMap);
      const res = await this.loadTurtle(kgTtl);
      totalTriples += res.triplesLoaded;
    }

    return {
      classesLoaded: classes.filter((c) => moduleIds.includes(c.moduleId)).length,
      propertiesLoaded: properties.filter((p) => moduleIds.includes(p.moduleId)).length,
      instancesLoaded: nodes.length,
      triplesLoaded: totalTriples,
    };
  }
}

export const semanticEngine = new SemanticEngineClient();
