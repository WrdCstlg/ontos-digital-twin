/**
 * The lock the processes sharing a semantic engine take (services/engineLock.ts).
 * Its name says which engine and which database it is for: processes that
 * share an engine and a database take the same one, and no others do. And an
 * engine given it runs each exclusive() task under it, stopping the task's
 * engine requests the moment the lock is lost.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ENGINE_LOCK_HOLD_MS, ENGINE_LOCK_WAIT_SECONDS, engineIdentity, engineLockName, installEngineLock } from "../services/engineLock";
import { SemanticEngineClient } from "../services/semanticEngine";
import { LockLost } from "../lib/namedLock";
import { fakeLockConnection, untilStopped } from "./fakeLockConnection";

afterEach(() => vi.restoreAllMocks());

describe("which engine a process uses", () => {
  it("is the engine's URL, however it is spelled", () => {
    const id = engineIdentity("http://engine-worker:8085");
    expect(engineIdentity("http://ENGINE-WORKER:8085/")).toBe(id);
    expect(engineIdentity("http://engine-worker")).toBe(engineIdentity("http://engine-worker:80"));
    expect(engineIdentity("http://engine-a:8085")).not.toBe(id);
    expect(engineIdentity("http://engine-worker:8086")).not.toBe(id);
  });

  it("and for an engine on loopback, which host it is on: each host's loopback is its own", () => {
    for (const url of ["http://127.0.0.1:8085", "http://localhost:8085", "http://[::1]:8085"]) {
      expect(engineIdentity(url, undefined, "host-a"), url).not.toBe(engineIdentity(url, undefined, "host-b"));
      expect(engineIdentity(url, undefined, "host-a")).toBe(engineIdentity(url, undefined, "HOST-A"));
    }
    expect(engineIdentity("http://engine-worker:8085", undefined, "host-a")).toBe(engineIdentity("http://engine-worker:8085", undefined, "host-b"));
  });

  it("unless ENGINE_LOCK_KEY names it, for processes that reach one engine by different URLs", () => {
    expect(engineIdentity("http://10.0.0.5:8085", "shared-engine")).toBe(engineIdentity("http://engine:8085", " shared-engine "));
    expect(engineIdentity("http://engine:8085", "  ")).toBe(engineIdentity("http://engine:8085"));
  });
});

describe("the engine lock's name", () => {
  const engine = "http://engine-worker:8085";

  it("is one per database: deployments whose databases share a MySQL server never wait for each other", () => {
    const ontos = engineLockName("mysql://ontos:pw@db:3306/ontos", engine);
    expect(engineLockName("mysql://ontos:pw@db:3306/ontos_staging", engine)).not.toBe(ontos);
    // The same database, however the server is reached, and whoever signs in.
    expect(engineLockName("mysql://root:other@10.0.0.2:3306/ontos?ssl=true", engine)).toBe(ontos);
    expect(engineLockName("mysql://ontos:pw@db:3306/ontos", "http://engine-a:8085")).not.toBe(ontos);
  });

  it("fits MySQL's limit", () => {
    expect(engineLockName(`mysql://u:p@db/${"d".repeat(64)}`, `http://${"e".repeat(200)}:8085`).length).toBeLessThanOrEqual(64);
  });
});

describe("an engine given the lock", () => {
  it("takes it around each exclusive() task, waiting and holding as long as the defaults allow", async () => {
    const conn = fakeLockConnection();
    const engine = new SemanticEngineClient();
    installEngineLock(engine, { connect: async () => conn, name: "ontos:engine:abc" });

    expect(await engine.exclusive(async () => "ran")).toBe("ran");
    expect(conn.calls).toContain(`SELECT GET_LOCK(?, ?) AS granted ["ontos:engine:abc",${ENGINE_LOCK_WAIT_SECONDS}]`);
    expect(conn.calls.at(-1)).toBe('SELECT RELEASE_LOCK(?) AS released ["ontos:engine:abc"]');
    expect(ENGINE_LOCK_HOLD_MS).toBeGreaterThan(60_000);
  });

  it("aborts the task's engine requests the moment the lock is lost, and refuses the task's result", async () => {
    const conn = fakeLockConnection();
    const engine = new SemanticEngineClient();
    installEngineLock(engine, { connect: async () => conn, name: "l" });
    vi.spyOn(engine, "ensureEngineRunning").mockResolvedValue(true);
    const requests: AbortSignal[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(init!.signal!);
      conn.emit("end");
      return untilStopped(init!.signal!);
    });

    await expect(engine.exclusive(() => engine.querySparql("SELECT * WHERE { ?s ?p ?o }"))).rejects.toBeInstanceOf(LockLost);
    expect(requests).toHaveLength(1);
    expect(requests[0].aborted).toBe(true);
    expect(requests[0].reason).toBeInstanceOf(LockLost);
  });

  it("stops waiting for the lock when the caller's signal aborts", async () => {
    const conn = fakeLockConnection({ getHangs: true });
    const engine = new SemanticEngineClient();
    installEngineLock(engine, { connect: async () => conn, name: "l" });
    const controller = new AbortController();
    const task = vi.fn(async () => 1);

    const run = engine.exclusive(task, { signal: controller.signal });
    await vi.waitFor(() => expect(conn.calls.some((c) => c.startsWith("SELECT GET_LOCK"))).toBe(true));
    controller.abort(new Error("worker stopping"));

    await expect(run).rejects.toThrow("the wait for lock l was called off: worker stopping");
    expect(task).not.toHaveBeenCalled();
  });
});
