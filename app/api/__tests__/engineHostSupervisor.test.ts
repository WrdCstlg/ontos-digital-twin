/**
 * The engine host's supervisor policy, on fake engine processes and a fake
 * clock: which engine runs, which stops, when a failed one starts again, and
 * how a failed open is classified. The data root is a real directory.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DataRoot } from "../services/engineHost/dataRoot";
import {
  MAX_IN_FLIGHT_PER_ENGINE,
  Supervisor,
  backoffMs,
  startTimeoutMs,
  type SupervisorOptions,
} from "../services/engineHost/supervisor";
import { FakeClock, FakeLauncher, portCounter, removeDir, settle, tempDir } from "./engineHostFakes";

const LINUX_LOCK =
  "Error: failed to open persistent Oxigraph store at /data/ws-1/triplestore: IO error: While lock file: /data/ws-1/triplestore/LOCK: Resource temporarily unavailable";
const CORRUPTION =
  "Error: failed to open persistent Oxigraph store at /data/ws-1/triplestore: Corruption: Bad table magic number";

let dir: string;
let root: DataRoot;
let clock: FakeClock;
let launcher: FakeLauncher;
let sup: Supervisor;
const others: Supervisor[] = [];

function supervisor(overrides: Partial<SupervisorOptions> = {}): Supervisor {
  return new Supervisor({
    root,
    launcher,
    maxEngines: 2,
    idleMs: 60_000,
    startTimeoutMs: 5_000,
    clock,
    probeHealth: async () => true,
    freePort: portCounter(),
    log: () => undefined,
    ...overrides,
  });
}

/** A promise's outcome, with its rejection handled at once. */
function outcome<T>(p: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  return p.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
}

beforeEach(async () => {
  dir = tempDir("ontos-supervisor-");
  root = await DataRoot.open(path.join(dir, "root"));
  clock = new FakeClock();
  launcher = new FakeLauncher();
  sup = supervisor();
});

afterEach(async () => {
  for (const s of [sup, ...others.splice(0)]) await s.close(0);
  await removeDir(dir);
});

describe("starting engines", () => {
  it("starts one engine on demand, however many requests arrive at once", async () => {
    const leases = await Promise.all([1, 2, 3, 4, 5].map(() => sup.acquire(1)));

    expect(launcher.of(1)).toHaveLength(1);
    expect(new Set(leases.map((l) => l.pid)).size).toBe(1);
    const status = await sup.status(1);
    expect(status).toMatchObject({ state: "busy", inFlight: 5, pid: leases[0].pid });
    expect(status.busySince).not.toBeNull();

    leases.forEach((l) => l.release());
    leases[0].release(); // a second release changes nothing
    expect(await sup.status(1)).toMatchObject({ state: "ready", inFlight: 0, busySince: null });
  });

  it("starts the engine persistent, on loopback, in the workspace's own directory, with a token of its own", async () => {
    (await sup.acquire(7)).release();
    const { spec } = launcher.latest(7);
    expect(spec).toMatchObject({ mode: "persistent", dataDir: root.storeDir(7), label: "ws-7" });
    expect(spec.token).toMatch(/^[0-9a-f]{48}$/);
    (await sup.acquire(8)).release();
    expect(launcher.latest(8).spec.token).not.toBe(spec.token);
  });

  it("answers status at once while an engine is starting", async () => {
    launcher.behavior = () => undefined;
    const pending = outcome(sup.acquire(1));
    await clock.waitForSleep(5_000);

    expect((await sup.status(1)).state).toBe("starting");

    launcher.latest(1).becomeReady(0);
    const { value } = await pending;
    value!.release();
    expect((await sup.status(1)).state).toBe("ready");
  });

  it("tells each request how long the engine had already been busy", async () => {
    const first = await sup.acquire(1);
    await clock.advance(500);
    const second = await sup.acquire(1);

    expect(first.busyMs).toBe(0);
    expect(second.busyMs).toBe(500);
    first.release();
    second.release();
    expect((await sup.acquire(1)).busyMs).toBe(0);
  });

  it(`refuses more than ${MAX_IN_FLIGHT_PER_ENGINE} requests in flight to one engine`, async () => {
    const leases = await Promise.all(Array.from({ length: MAX_IN_FLIGHT_PER_ENGINE }, () => sup.acquire(1)));
    await expect(sup.acquire(1)).rejects.toMatchObject({ status: 503, code: "at_capacity" });
    leases.forEach((l) => l.release());
  });

  it("gives the store a start timeout that grows with its size, and doubles after a timeout", async () => {
    expect(startTimeoutMs(10_000, null, 0)).toBe(10_000);
    expect(startTimeoutMs(10_000, 2_000_000, 0)).toBe(40_000);
    expect(startTimeoutMs(10_000, 0, 2)).toBe(40_000);
    expect(startTimeoutMs(10_000, 1e12, 9)).toBe(30 * 60_000);

    launcher.behavior = (p) => p.becomeReady(2_000_000);
    (await sup.acquire(1)).release();
    await clock.advance(60_000);
    await sup.sweep();
    expect((await sup.status(1)).triples).toBe(2_000_000);

    launcher.behavior = () => undefined;
    const pending = outcome(sup.acquire(1));
    await clock.waitForSleep(5_000 + 30_000);
    launcher.latest(1).becomeReady(2_000_000);
    (await pending).value!.release();
  });
});

describe("limits", () => {
  it("runs at most maxEngines, stopping the least recently used idle one to start another", async () => {
    (await sup.acquire(1)).release();
    await clock.advance(1_000);
    (await sup.acquire(2)).release();
    await clock.advance(1_000);
    (await sup.acquire(1)).release(); // 1 is now the more recently used
    await clock.advance(1_000);

    (await sup.acquire(3)).release();

    expect(launcher.latest(2).signals).toEqual(["SIGTERM"]);
    expect(launcher.latest(1).exit()).toBeNull();
    expect(launcher.latest(3).exit()).toBeNull();
    expect(sup.liveCount()).toBe(2);
    expect((await sup.status(2)).state).toBe("cold");
  });

  it("never stops a busy engine: with every engine busy, another start is refused", async () => {
    const a = await sup.acquire(1);
    const b = await sup.acquire(2);

    await expect(sup.acquire(3)).rejects.toMatchObject({ status: 503, code: "at_capacity" });
    expect(launcher.of(3)).toHaveLength(0);
    expect(launcher.running()).toHaveLength(2);
    expect((await sup.status(3)).state).toBe("cold");

    a.release();
    const c = await sup.acquire(3);
    expect(launcher.latest(1).signals).toEqual(["SIGTERM"]);
    expect(launcher.latest(2).exit()).toBeNull();
    b.release();
    c.release();
  });

  it("stops an engine idle for idleMs, and never one with a request in flight", async () => {
    (await sup.acquire(1)).release();
    const held = await sup.acquire(2);

    await clock.advance(59_000);
    await sup.sweep();
    expect(launcher.running()).toHaveLength(2);

    await clock.advance(1_000);
    await sup.sweep();
    expect(launcher.latest(1).signals).toEqual(["SIGTERM"]);
    expect(launcher.latest(2).exit()).toBeNull();

    held.release();
    await clock.advance(60_000);
    await sup.sweep();
    expect(launcher.running()).toHaveLength(0);

    // The next request starts it again.
    (await sup.acquire(1)).release();
    expect(launcher.of(1)).toHaveLength(2);
  });

  it("stops an engine that ignores SIGTERM with SIGKILL", async () => {
    launcher.behavior = (p) => {
      p.stubborn = true;
      p.becomeReady(0);
    };
    (await sup.acquire(1)).release();

    const removing = sup.remove(1);
    await clock.waitForSleep(5_000);
    await clock.advance(5_000);
    await removing;

    expect(launcher.latest(1).signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("stops every engine on close, and refuses requests after", async () => {
    (await sup.acquire(1)).release();
    (await sup.acquire(2)).release();

    await sup.close(0);

    expect(launcher.running()).toHaveLength(0);
    await expect(sup.acquire(1)).rejects.toMatchObject({ status: 503, code: "shutting_down" });
  });
});

describe("crashes and backoff", () => {
  it("waits 1, 2, 4 … 60 s before starting a failed engine again", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 30].map(backoffMs)).toEqual([
      0, 1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000,
    ]);
  });

  it("starts an engine that exited again on the next request after its backoff", async () => {
    (await sup.acquire(1)).release();

    for (const wait of [1_000, 2_000, 4_000]) {
      launcher.latest(1).exitWith(101, "thread 'main' panicked");
      await settle();
      const status = await sup.status(1);
      expect(status.state).toBe("failed");
      expect(Date.parse(status.retryAt!) - clock.now()).toBe(wait);
      await expect(sup.acquire(1)).rejects.toMatchObject({
        status: 503,
        code: "engine_unavailable",
        extra: { retryAfterMs: wait },
      });

      await clock.advance(wait);
      (await sup.acquire(1)).release();
    }
    expect(launcher.of(1)).toHaveLength(4);
    expect((await sup.status(1)).state).toBe("ready");
  });

  it("starts a new failure streak once an engine stayed up a minute", async () => {
    (await sup.acquire(1)).release();
    launcher.latest(1).exitWith(101);
    await settle();
    await clock.advance(1_000);
    (await sup.acquire(1)).release();

    await clock.advance(61_000);
    launcher.latest(1).exitWith(101);
    await settle();

    expect(Date.parse((await sup.status(1)).retryAt!) - clock.now()).toBe(1_000);
  });
});

describe("failed opens", () => {
  it("a store another process holds is locked: refused with 503, never corrupt, never reset or deleted", async () => {
    const store = path.join(root.storeDir(1), "triplestore");
    fs.mkdirSync(store, { recursive: true });
    fs.writeFileSync(path.join(store, "CURRENT"), "MANIFEST-000001\n");
    launcher.behavior = (p) => p.exitWith(1, LINUX_LOCK);

    for (let attempt = 0; attempt < 6; attempt++) {
      await expect(sup.acquire(1)).rejects.toMatchObject({ status: 503, code: "locked" });
      expect((await sup.status(1)).state).toBe("locked");
      await clock.advance(60_000);
    }
    await expect(sup.reset(1)).rejects.toMatchObject({ status: 503, code: "locked" });
    await expect(sup.remove(1)).rejects.toMatchObject({ status: 503, code: "locked" });

    expect((await sup.status(1)).state).toBe("locked");
    expect(fs.readFileSync(path.join(store, "CURRENT"), "utf8")).toBe("MANIFEST-000001\n");
    expect(fs.readdirSync(root.trashDir)).toEqual([]);
  });

  it("recognises Windows' words for a held LOCK too", async () => {
    launcher.behavior = (p) =>
      p.exitWith(
        1,
        "Error: failed to open persistent Oxigraph store at C:\\data\\ws-1\\triplestore: IO error: Failed to create lock file: C:\\data\\ws-1\\triplestore/LOCK: The process cannot access the file because it is being used by another process.",
      );
    await expect(sup.acquire(1)).rejects.toMatchObject({ code: "locked" });
  });

  it("three failed opens in a row mark the store corrupt, a mark that survives a restart and only a reset clears", async () => {
    launcher.behavior = (p) => p.exitWith(1, CORRUPTION);

    await expect(sup.acquire(1)).rejects.toMatchObject({ status: 503, code: "engine_unavailable" });
    await clock.advance(1_000);
    await expect(sup.acquire(1)).rejects.toMatchObject({ status: 503, code: "engine_unavailable" });
    await clock.advance(2_000);
    await expect(sup.acquire(1)).rejects.toMatchObject({ status: 409, code: "corrupt" });
    await clock.advance(120_000);
    await expect(sup.acquire(1)).rejects.toMatchObject({ status: 409, code: "corrupt" });
    expect(launcher.of(1)).toHaveLength(3); // no fourth try
    expect((await sup.status(1)).state).toBe("corrupt");

    const restarted = supervisor();
    others.push(restarted);
    expect((await restarted.status(1)).state).toBe("corrupt");
    await expect(restarted.acquire(1)).rejects.toMatchObject({ code: "corrupt" });
    expect(launcher.of(1)).toHaveLength(3);

    // The reset's check that no one else holds the store fails the same way,
    // which proves the LOCK free; then the new store opens.
    let starts = 0;
    launcher.behavior = (p) => (starts++ === 0 ? p.exitWith(1, CORRUPTION) : p.becomeReady(0));
    const incarnation = await sup.reset(1);
    expect(await sup.status(1)).toMatchObject({ state: "ready", incarnation, failures: 0 });
    (await sup.acquire(1)).release();
  });

  it("a start that times out is stopped and counts as a failed open; the next one waits twice as long", async () => {
    launcher.behavior = () => undefined;

    const first = outcome(sup.acquire(1));
    await clock.waitForSleep(5_000);
    await clock.advance(5_000);
    expect((await first).error).toMatchObject({ status: 503, code: "engine_unavailable" });
    expect(launcher.latest(1).signals).toEqual(["SIGTERM"]);

    await clock.advance(1_000);
    const second = outcome(sup.acquire(1));
    await clock.waitForSleep(10_000);
    launcher.latest(1).becomeReady(0);
    (await second).value!.release();
    expect((await sup.status(1)).state).toBe("ready");
  });

  it("a port another process took is tried again on another one, and is no failure", async () => {
    let starts = 0;
    launcher.behavior = (p) =>
      starts++ === 0 ? p.exitWith(1, "Error: Address already in use (os error 98)") : p.becomeReady(0);

    (await sup.acquire(1)).release();

    expect(launcher.of(1).map((p) => p.spec.port)).toEqual([40_000, 40_001]);
    expect(await sup.status(1)).toMatchObject({ state: "ready", failures: 0 });
  });

  it("a binary that cannot be started is a failure with backoff, not a sign of corruption", async () => {
    launcher.behavior = (p) => p.failToSpawn("spawn open-ontologies ENOENT");
    for (const wait of [1_000, 2_000, 4_000, 8_000]) {
      await expect(sup.acquire(1)).rejects.toMatchObject({ status: 503, code: "engine_unavailable" });
      await clock.advance(wait);
    }
    expect((await sup.status(1)).state).toBe("failed");
  });
});

describe("incarnations and deletion", () => {
  it("gives a store an incarnation when it first opens, a new one on each reset, kept on disk", async () => {
    expect((await sup.status(1)).incarnation).toBeNull();
    (await sup.acquire(1)).release();
    const first = (await sup.status(1)).incarnation;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);

    const second = await sup.reset(1);
    expect(second).not.toBe(first);
    expect(launcher.of(1)).toHaveLength(2);

    const restarted = supervisor();
    others.push(restarted);
    expect((await restarted.status(1)).incarnation).toBe(second);
    expect(await restarted.incarnation(1)).toBe(second);
  });

  it("gives a store deleted behind its back a new incarnation when it opens again", async () => {
    (await sup.acquire(1)).release();
    const first = (await sup.status(1)).incarnation;
    await clock.advance(60_000);
    await sup.sweep();
    fs.rmSync(root.storeDir(1), { recursive: true, force: true });

    const lease = await sup.acquire(1);
    expect(lease.incarnation).not.toBe(first);
    lease.release();
  });

  it("delete stops the engine and removes its store", async () => {
    (await sup.acquire(1)).release();
    expect(fs.existsSync(root.storeDir(1))).toBe(true);

    await sup.remove(1);

    expect(launcher.latest(1).signals).toEqual(["SIGTERM"]);
    expect(fs.existsSync(root.storeDir(1))).toBe(false);
    expect(await sup.status(1)).toMatchObject({ state: "cold", incarnation: null });
    expect(fs.readdirSync(root.trashDir)).toEqual([]);
  });

  it("a request that arrives during a reset waits for it, and gets the new store", async () => {
    (await sup.acquire(1)).release();
    const resetting = sup.reset(1);
    const lease = await sup.acquire(1);
    const incarnation = await resetting;
    expect(lease.incarnation).toBe(incarnation);
    lease.release();
  });
});
