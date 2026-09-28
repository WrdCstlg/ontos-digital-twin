/**
 * MySQL named locks on a real server (lib/namedLock.ts, services/engineLock.ts),
 * what the scripted session in namedLock.test.ts can only imitate. Sessions
 * exclude each other. A holder whose session is killed loses the lock at once:
 * its task is stopped, another session takes the lock, and the holder's result
 * is refused. A holder that goes quiet keeps the others out only for its
 * session's idle limit. A wait called off leaves the lock free. And two engine
 * clients given one lock never run their tasks at once.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mysql from "mysql2/promise";
import { lockName, LockLost, LockUnavailable, LOCK_SESSION_IDLE_SECONDS, withNamedLock } from "../../lib/namedLock";
import { openConnection } from "../../queries/connection";
import { testDatabase } from "./database";
import { installEngineLock } from "../../services/engineLock";
import { SemanticEngineClient } from "../../services/semanticEngine";

const opts = { waitSeconds: 5, holdMs: 30_000 };
/** Lock names are the server's: this run's database keeps them apart from another run's on the same server. */
const testLock = (what: string) => lockName("test", `${testDatabase()} ${what}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Something a task waits for, and the test opens. */
function latch() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

let admin: mysql.Connection;
beforeAll(async () => {
  admin = await mysql.createConnection(process.env.DATABASE_URL!);
});
afterAll(async () => {
  await admin?.end();
});

/** The id of the session holding `name`, or null. */
async function holderOf(name: string): Promise<number | null> {
  const [[row]] = await admin.query<mysql.RowDataPacket[]>("SELECT IS_USED_LOCK(?) AS holder", [name]);
  return row.holder === null ? null : Number(row.holder);
}
const heldBySomeone = (name: string) => vi.waitFor(async () => expect(await holderOf(name)).not.toBeNull());

describe("a named lock on a real MySQL", () => {
  it("keeps a second session waiting while the first holds it, and lets it in once the first lets go", async () => {
    const name = testLock("exclusion");
    const events: string[] = [];
    const first = latch();
    const a = withNamedLock(openConnection, name, opts, async () => {
      events.push("a in");
      await first.opened;
      events.push("a out");
    });
    await heldBySomeone(name);
    const b = withNamedLock(openConnection, name, opts, async () => void events.push("b in"));

    await sleep(300);
    expect(events).toEqual(["a in"]);
    first.open();
    await Promise.all([a, b]);
    expect(events).toEqual(["a in", "a out", "b in"]);
    expect(await holderOf(name)).toBeNull();
  });

  it("turns a session away that cannot have it in time, without running its task", async () => {
    const name = testLock("refusal");
    const first = latch();
    const a = withNamedLock(openConnection, name, opts, () => first.opened);
    await heldBySomeone(name);

    const task = vi.fn(async () => 1);
    await expect(withNamedLock(openConnection, name, { ...opts, waitSeconds: 1 }, task)).rejects.toThrow(
      new LockUnavailable(`lock ${name} stayed held elsewhere for 1 s`),
    );
    expect(task).not.toHaveBeenCalled();
    first.open();
    await a;
  });

  it("is lost the moment its session is killed: the task is stopped, another session takes it, and the result is refused", async () => {
    const name = testLock("killed");
    let stoppedWith: unknown;
    const a = withNamedLock(openConnection, name, opts, async (signal) => {
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      stoppedWith = signal.reason;
      // It carries on a moment, as an engine request already sent would.
      await sleep(300);
      return "a result taken without the lock";
    });
    await heldBySomeone(name);

    await admin.query(`KILL ${await holderOf(name)}`);
    await vi.waitFor(() => expect(stoppedWith).toBeInstanceOf(LockLost), { timeout: 2000 });
    // Free for anyone while the task that lost it is still running.
    const [[{ got }]] = await admin.query<mysql.RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS got", [name]);
    expect(Number(got)).toBe(1);
    await expect(a).rejects.toBeInstanceOf(LockLost);
    await admin.query("SELECT RELEASE_LOCK(?)", [name]);
  });

  it("holds it on a session whose idle limit is its own, and whose statements no server-wide limit cuts short", async () => {
    const name = testLock("session");
    const settings = await withNamedLock(openConnection, name, opts, async () => {
      const [rows] = await admin.query<mysql.RowDataPacket[]>(
        `SELECT v.VARIABLE_NAME AS name, v.VARIABLE_VALUE AS value
           FROM performance_schema.variables_by_thread v JOIN performance_schema.threads t ON t.THREAD_ID = v.THREAD_ID
          WHERE t.PROCESSLIST_ID = ? AND v.VARIABLE_NAME IN ('wait_timeout', 'max_execution_time')`,
        [await holderOf(name)],
      );
      return Object.fromEntries(rows.map((r) => [r.name, Number(r.value)]));
    });
    expect(settings).toEqual({ wait_timeout: LOCK_SESSION_IDLE_SECONDS, max_execution_time: 0 });
  });

  it("is freed by MySQL when its holder goes quiet without closing its session, once the session's idle limit passes", async () => {
    const name = testLock("frozen");
    // A holder frozen after taking it, as a paused process's would be: its
    // session stays open and says nothing. Here with a 2 s idle limit.
    const frozen = await mysql.createConnection(process.env.DATABASE_URL!);
    frozen.on("error", () => undefined);
    await frozen.query("SET SESSION wait_timeout = 2");
    const [[{ got }]] = await frozen.query<mysql.RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS got", [name]);
    expect(Number(got)).toBe(1);

    const waitFrom = Date.now();
    expect(await withNamedLock(openConnection, name, { ...opts, waitSeconds: 15 }, async () => "in")).toBe("in");
    const waited = Date.now() - waitFrom;
    expect(waited).toBeGreaterThan(1_000);
    expect(waited).toBeLessThan(12_000);
    frozen.destroy();
  }, 20_000);

  it("stops waiting at once when the wait is called off, and leaves the lock free for the next session", async () => {
    const name = testLock("called-off");
    const first = latch();
    const a = withNamedLock(openConnection, name, opts, () => first.opened);
    await heldBySomeone(name);
    const caller = new AbortController();
    const task = vi.fn(async () => 1);
    const b = withNamedLock(openConnection, name, { ...opts, waitSeconds: 30, signal: caller.signal }, task);
    await sleep(200);

    const calledOffAt = Date.now();
    caller.abort(new Error("worker stopping"));
    await expect(b).rejects.toThrow(`the wait for lock ${name} was called off: worker stopping`);
    expect(Date.now() - calledOffAt).toBeLessThan(500);

    first.open();
    await a;
    expect(await withNamedLock(openConnection, name, { ...opts, waitSeconds: 3 }, async () => "next")).toBe("next");
    expect(task).not.toHaveBeenCalled();
    await vi.waitFor(async () => expect(await holderOf(name)).toBeNull());
  });
});

describe("two engine clients given one lock", () => {
  it("never run their tasks at once", async () => {
    const name = testLock("two-engines");
    const engines = [new SemanticEngineClient(), new SemanticEngineClient()];
    for (const engine of engines) installEngineLock(engine, { connect: openConnection, name, waitSeconds: 10 });
    const spans: { who: number; from: number; to: number }[] = [];

    await Promise.all(
      engines.flatMap((engine, who) =>
        [1, 2, 3].map(() =>
          engine.exclusive(async () => {
            const from = performance.now();
            await sleep(50);
            spans.push({ who, from, to: performance.now() });
          }),
        ),
      ),
    );

    expect(spans).toHaveLength(6);
    expect(new Set(spans.map((s) => s.who)).size).toBe(2);
    spans.sort((x, y) => x.from - y.from);
    for (let i = 1; i < spans.length; i++) expect(spans[i].from).toBeGreaterThanOrEqual(spans[i - 1].to);
  });
});
