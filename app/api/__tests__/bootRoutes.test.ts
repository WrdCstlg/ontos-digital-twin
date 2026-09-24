import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";

// Engine stub whose steps record whether they ran inside exclusive().
const engine = vi.hoisted(() => {
  const lock = { held: false, log: [] as string[] };
  const record = (step: string) => lock.log.push(`${step}:${lock.held ? "locked" : "UNLOCKED"}`);
  return {
    lock,
    ensureEngineRunning: vi.fn(async () => true),
    checkHealth: vi.fn(async () => ({ alive: true, url: "test" })),
    syncWorkspace: vi.fn<(workspaceId: number) => Promise<object>>(async () => {
      record("syncWorkspace");
      return {};
    }),
    ensureWorkspaceLoaded: vi.fn<(workspaceId: number) => Promise<void>>(async () => {
      record("ensureWorkspaceLoaded");
    }),
    querySparql: vi.fn<(query: string) => Promise<{ variables: string[]; results: Record<string, string>[] }>>(
      async () => {
        record("querySparql");
        return { variables: ["s"], results: [{ s: "<urn:a>" }] };
      },
    ),
    exclusive: vi.fn(async (task: () => Promise<unknown>) => {
      lock.held = true;
      try {
        return await task();
      } finally {
        lock.held = false;
      }
    }),
  };
});

const ingest = vi.hoisted(() => ({
  ingestTelemetry: vi.fn(),
  webhookWorkspaceId: vi.fn(async () => 1),
  sampleDeviceId: vi.fn(async () => null),
}));

vi.mock("../services/semanticEngine", () => ({ semanticEngine: engine }));
vi.mock("../services/iot/iotIngestion", () => ingest);
vi.mock("../services/iot/iotBrokerManager", () => ({
  iotBrokerManager: { init: vi.fn(async () => undefined) },
}));
vi.mock("../auth/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../auth/service")>()),
  authenticateRequest: vi.fn(async () => ({ id: 7, role: "viewer", email: "v@acme.test" })),
}));
vi.mock("../services/workspaceGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/workspaceGuard")>()),
  resolveUserWorkspace: vi.fn(async () => ({
    workspace: { id: 42, slug: "acme" },
    membership: { role: "viewer" },
  })),
}));

let app: Hono;

beforeAll(async () => {
  app = (await import("../boot")).default as unknown as Hono;
});

afterEach(() => {
  engine.lock.log.length = 0;
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function sparql(query: string, headers: Record<string, string> = {}) {
  return app.request("/api/sparql", {
    method: "POST",
    headers: { "content-type": "application/sparql-query", ...headers },
    body: query,
  });
}

describe("POST /api/sparql", () => {
  it("re-syncs the caller's workspace and queries it, both under the engine lock", async () => {
    const res = await sparql("SELECT ?s WHERE { ?s ?p ?o }");

    expect(res.status).toBe(200);
    expect(engine.syncWorkspace).toHaveBeenCalledWith(42);
    expect(engine.ensureWorkspaceLoaded).not.toHaveBeenCalled();
    expect(engine.lock.log).toEqual(["syncWorkspace:locked", "querySparql:locked"]);
  });

  it("with x-auto-sync: false, still loads the caller's workspace unless the store holds it", async () => {
    const res = await sparql("SELECT ?s WHERE { ?s ?p ?o }", { "x-auto-sync": "false" });

    expect(res.status).toBe(200);
    expect(engine.syncWorkspace).not.toHaveBeenCalled();
    expect(engine.ensureWorkspaceLoaded).toHaveBeenCalledWith(42);
    expect(engine.lock.log).toEqual(["ensureWorkspaceLoaded:locked", "querySparql:locked"]);
  });

  it("rejects update forms before touching the engine", async () => {
    const res = await sparql("INSERT DATA { <urn:a> <urn:b> <urn:c> }");

    expect(res.status).toBe(400);
    expect(engine.exclusive).not.toHaveBeenCalled();
    expect(engine.querySparql).not.toHaveBeenCalled();
  });

  it("returns a query error as 400 without leaving the lock held", async () => {
    engine.querySparql.mockRejectedValueOnce(new Error("SPARQL error: parse failure"));

    const res = await sparql("SELECT ?s WHERE { ?s ?p ?o }");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "SPARQL error: parse failure" });
    expect(engine.lock.held).toBe(false);
  });
});

describe("POST /api/iot/telemetry", () => {
  function telemetry(body: string) {
    return app.request("/api/iot/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json", "x-iot-api-key": "k-test" },
      body,
    });
  }

  it("answers malformed JSON with 400", async () => {
    vi.stubEnv("IOT_WEBHOOK_API_KEY", "k-test");

    const res = await telemetry("{not json");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Malformed JSON payload" });
  });

  it("answers an internal failure with a generic 500 that names no internals", async () => {
    vi.stubEnv("IOT_WEBHOOK_API_KEY", "k-test");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    ingest.ingestTelemetry.mockRejectedValueOnce(
      new Error("connect ECONNREFUSED 10.0.3.7:3306 (mysql://ontos@db/ontos)"),
    );

    const res = await telemetry(JSON.stringify({ deviceId: "d1", temperature: 4 }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Telemetry ingestion failed" });
    expect(JSON.stringify(body)).not.toContain("10.0.3.7");
  });
});
