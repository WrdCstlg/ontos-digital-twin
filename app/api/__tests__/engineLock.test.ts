import { afterEach, describe, expect, it, vi } from "vitest";

// An empty workspace: syncWorkspace finds no modules, clears the store and
// records the workspace as loaded, without needing any rows.
vi.mock("../queries/connection", () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
    })),
  })),
}));

/** Engine stub: /health is always up; every other call answers `status`. */
function stubEngine(status = 200) {
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const target = String(url);
    if (target.endsWith("/health")) {
      return new Response(JSON.stringify({ status: "ok", version: "test" }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function freshEngine() {
  vi.resetModules();
  const { semanticEngine } = await import("../services/semanticEngine");
  return semanticEngine;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Semantic engine exclusive lock", () => {
  it("runs compound operations one at a time, in the order they were submitted", async () => {
    const engine = await freshEngine();
    const events: string[] = [];
    const gate = deferred();

    const first = engine.exclusive(async () => {
      events.push("first:start");
      await gate.promise;
      events.push("first:end");
      return 1;
    });
    const second = engine.exclusive(async () => {
      events.push("second:start");
      return 2;
    });

    // Give the second task every chance to start early.
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual(["first:start"]);

    gate.resolve();
    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("does not let a failed operation block the ones queued behind it", async () => {
    const engine = await freshEngine();

    const failing = engine.exclusive(async () => {
      throw new Error("engine fell over");
    });
    const next = engine.exclusive(async () => "still runs");

    await expect(failing).rejects.toThrow("engine fell over");
    await expect(next).resolves.toBe("still runs");
  });
});

describe("Semantic engine workspace tracking", () => {
  it("syncs only when the store does not already hold the requested workspace", async () => {
    stubEngine();
    const engine = await freshEngine();
    const sync = vi.spyOn(engine, "syncWorkspace");

    await engine.ensureWorkspaceLoaded(1);
    expect(sync).toHaveBeenCalledTimes(1);

    // Store holds workspace 1: no sync.
    await engine.ensureWorkspaceLoaded(1);
    expect(sync).toHaveBeenCalledTimes(1);

    // Another workspace is never served from workspace 1's graph.
    await engine.ensureWorkspaceLoaded(2);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(sync).toHaveBeenLastCalledWith(2);

    await engine.ensureWorkspaceLoaded(1);
    expect(sync).toHaveBeenCalledTimes(3);
    expect(sync).toHaveBeenLastCalledWith(1);
  });

  it("forgets the loaded workspace after any partial load, clear, update or reasoning run", async () => {
    stubEngine();
    const engine = await freshEngine();
    const sync = vi.spyOn(engine, "syncWorkspace");

    const disturbances: Array<() => Promise<unknown>> = [
      () => engine.loadTurtle("@prefix ex: <https://ontos.dev/test/> ."),
      () => engine.clearStore(),
      () => engine.updateSparql("INSERT DATA { <urn:a> <urn:b> <urn:c> }"),
      // The stub answers the reasoning batch with no result, so it throws after
      // touching the store; the store must still count as changed.
      () => engine.runReasoning("rdfs").catch(() => undefined),
    ];

    await engine.ensureWorkspaceLoaded(1);
    let expectedSyncs = 1;

    for (const disturb of disturbances) {
      await disturb();

      // The store no longer holds exactly workspace 1: re-sync once…
      await engine.ensureWorkspaceLoaded(1);
      expectedSyncs += 1;
      expect(sync).toHaveBeenCalledTimes(expectedSyncs);

      // …after which it does again, and the next call skips.
      await engine.ensureWorkspaceLoaded(1);
      expect(sync).toHaveBeenCalledTimes(expectedSyncs);
    }
  });

  it("throws when the engine refuses to clear, and does not mark the workspace as loaded", async () => {
    stubEngine(500);
    const engine = await freshEngine();

    await expect(engine.clearStore()).rejects.toThrow("Failed to clear the engine store: HTTP 500");
    await expect(engine.ensureWorkspaceLoaded(1)).rejects.toThrow("Failed to clear");

    // Once the engine recovers, the next request syncs instead of trusting a
    // store that may still hold another graph.
    stubEngine(200);
    const sync = vi.spyOn(engine, "syncWorkspace");
    await engine.ensureWorkspaceLoaded(1);
    expect(sync).toHaveBeenCalledTimes(1);
  });
});
