/**
 * The rate limiter, without MySQL: the window arithmetic, and the limiter's
 * transactions against the in-memory stand-in for rate_limit_windows
 * (memoryRateLimits.ts). mysql/rateLimits.mysql.test.ts checks what the SQL
 * does on a real MySQL: row locks across pools, the database's clock, and
 * sessions in other time zones.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";
import {
  IDLE_HOURS,
  LIMIT_TIMEOUT_MS,
  RateLimitUnavailable,
  RateLimiter,
  dropNewest,
  enforceLimit,
  limitSubject,
  slideWindow,
  sweepIdleRateLimits,
} from "../lib/rateLimit";
import { memoryPool, type LimitTable } from "./memoryRateLimits";

/** A time on the database's clock, in epoch ms. */
const T0 = 1_790_000_000_000;
const MINUTE = 60_000;

const tableAt = (now?: () => number): LimitTable => ({ rows: new Map(), log: [], connections: [], now });
const limiterOn = (table: LimitTable, options = { windowMs: MINUTE, max: 3 }, bucket = "test") =>
  new RateLimiter(bucket, options, () => memoryPool(table));
const statements = (table: LimitTable) => (table.log ?? []).map((s) => s.sql.split(" ").slice(0, 2).join(" "));
const outage = () => Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3306"), { code: "ECONNREFUSED" });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the window: an exact sliding log", () => {
  const options = { windowMs: MINUTE, max: 3 };

  it("lets requests through up to max, counting down what remains, then refuses without keeping the refusal", () => {
    let hits: number[] = [];
    const verdicts = [T0, T0 + 1, T0 + 2, T0 + 3].map((now) => {
      const next = slideWindow(hits, now, options);
      hits = next.hits;
      return next.status;
    });
    expect(verdicts).toEqual([
      { allowed: true, remaining: 2, resetMs: MINUTE },
      { allowed: true, remaining: 1, resetMs: MINUTE },
      { allowed: true, remaining: 0, resetMs: MINUTE },
      { allowed: false, remaining: 0, resetMs: MINUTE - 3 },
    ]);
    expect(hits).toEqual([T0, T0 + 1, T0 + 2]);
  });

  it("drops the times that have left the window, a time exactly a window old among them", () => {
    const full = [T0, T0 + 10, T0 + 20];
    expect(slideWindow(full, T0 + MINUTE - 1, options).status).toEqual({ allowed: false, remaining: 0, resetMs: 1 });
    expect(slideWindow(full, T0 + MINUTE, options)).toEqual({
      hits: [T0 + 10, T0 + 20, T0 + MINUTE],
      status: { allowed: true, remaining: 0, resetMs: MINUTE },
    });
  });

  it("prunes a refused log too, and says when its oldest time leaves the window", () => {
    expect(slideWindow([T0 - 2 * MINUTE, T0, T0 + 5, T0 + 9], T0 + 30_000, options)).toEqual({
      hits: [T0, T0 + 5, T0 + 9],
      status: { allowed: false, remaining: 0, resetMs: 30_000 },
    });
  });

  it("keeps the newest max times of a log kept under a larger limit, and refuses until one leaves", () => {
    expect(slideWindow([T0, T0 + 1, T0 + 2, T0 + 3, T0 + 4], T0 + 10, options)).toEqual({
      hits: [T0 + 2, T0 + 3, T0 + 4],
      status: { allowed: false, remaining: 0, resetMs: MINUTE - 8 },
    });
  });

  it("keeps the log in order when the clock stepped back", () => {
    expect(slideWindow([T0, T0 + 500], T0 + 200, options).hits).toEqual([T0, T0 + 200, T0 + 500]);
  });

  it("dropNewest takes back the newest time, and the times that left the window", () => {
    expect(dropNewest([T0, T0 + 1, T0 + 2], T0 + 3, MINUTE)).toEqual([T0, T0 + 1]);
    expect(dropNewest([T0 - 2 * MINUTE, T0], T0 + 1, MINUTE)).toEqual([]);
    expect(dropNewest([], T0, MINUTE)).toEqual([]);
  });
});

describe("the subject a key is kept under", () => {
  it("is the key's SHA-256 in hex, the same every time, and names nothing of the key", () => {
    const subject = limitSubject("ada@example.com");
    expect(subject).toBe("b5fc85e55755f9e0d030a10ab4429b6b2944855f9a0d60077fe832becbc41d72");
    expect(limitSubject("ada@example.com")).toBe(subject);
    expect(limitSubject("grace@example.com")).not.toBe(subject);
    expect(subject).not.toContain("ada");
  });
});

describe("a limiter, kept in the database", () => {
  it("lets requests through up to max within the window, then refuses; another key has its own count", async () => {
    const limiter = limiterOn(tableAt());
    const verdicts = [];
    for (let i = 0; i < 4; i++) verdicts.push((await limiter.check("ada")).allowed);
    expect(verdicts).toEqual([true, true, true, false]);
    expect((await limiter.check("grace")).allowed).toBe(true);
  });

  it("counts on the database's clock: it keeps the database's times, and a window moves with them", async () => {
    let now = T0;
    const table = tableAt(() => now);
    const limiter = limiterOn(table, { windowMs: MINUTE, max: 2 });
    await limiter.check("ada");
    now += 1_000;
    await limiter.check("ada");
    expect([...table.rows.values()][0].hits).toEqual([T0, T0 + 1_000]);
    expect(await limiter.check("ada")).toEqual({ allowed: false, remaining: 0, resetMs: MINUTE - 1_000 });

    now = T0 + MINUTE;
    expect(await limiter.check("ada")).toEqual({ allowed: true, remaining: 0, resetMs: MINUTE });
    expect([...table.rows.values()][0].hits).toEqual([T0 + 1_000, T0 + MINUTE]);
  });

  it("keeps each key under its bucket and SHA-256: the key is never stored, nor sent to the database", async () => {
    const table = tableAt();
    await limiterOn(table, undefined, "auth").check("ada@example.com");
    expect([...table.rows.keys()]).toEqual([`auth/${limitSubject("ada@example.com")}`]);
    expect(JSON.stringify(table.log)).not.toContain("ada@example.com");
  });

  it("shares its counts with every limiter of its bucket, and with no other", async () => {
    const table = tableAt();
    const here = limiterOn(table, { windowMs: MINUTE, max: 2 });
    const there = limiterOn(table, { windowMs: MINUTE, max: 2 });
    await here.check("ada");
    await there.check("ada");
    expect((await here.check("ada")).allowed).toBe(false);
    expect((await limiterOn(table, { windowMs: MINUTE, max: 2 }, "other").check("ada")).allowed).toBe(true);
  });

  it("release takes back the newest request only, so an attempt that reached no verdict does not count", async () => {
    const limiter = limiterOn(tableAt(), { windowMs: MINUTE, max: 2 });
    await limiter.check("ada");
    await limiter.check("ada");
    await limiter.release("ada");
    expect((await limiter.check("ada")).allowed).toBe(true);
    expect((await limiter.check("ada")).allowed).toBe(false);
  });

  it("release of a key with nothing counted changes nothing, and makes no row", async () => {
    const table = tableAt();
    const limiter = limiterOn(table, { windowMs: MINUTE, max: 1 });
    await limiter.release("nobody");
    expect(table.rows.size).toBe(0);
    expect((await limiter.check("nobody")).allowed).toBe(true);
    expect((await limiter.check("nobody")).allowed).toBe(false);
  });

  it("reset forgets every request counted under the key, and nothing else", async () => {
    const table = tableAt();
    const limiter = limiterOn(table, { windowMs: MINUTE, max: 1 });
    await limiter.check("ada");
    await limiter.check("grace");
    await limiter.reset("ada");
    expect([...table.rows.keys()]).toEqual([`test/${limitSubject("grace")}`]);
    expect((await limiter.check("ada")).allowed).toBe(true);
    expect((await limiter.check("grace")).allowed).toBe(false);
  });

  it("checks in one transaction at READ COMMITTED that locks the row before reading it, and writes only a changed log", async () => {
    const table = tableAt();
    const limiter = limiterOn(table, { windowMs: MINUTE, max: 1 });
    await limiter.check("ada");
    expect(statements(table)).toEqual(["SET TRANSACTION", "START TRANSACTION", "INSERT INTO", "SELECT hits,", "UPDATE rate_limit_windows", "COMMIT"]);
    expect(table.log?.[3].sql).toMatch(/FOR UPDATE$/);

    // A refusal with nothing to prune changes nothing, and writes nothing.
    table.log = [];
    expect((await limiter.check("ada")).allowed).toBe(false);
    expect(statements(table)).toEqual(["SET TRANSACTION", "START TRANSACTION", "INSERT INTO", "SELECT hits,", "COMMIT"]);
    // Every statement is bounded in time.
    for (const s of table.log) {
      expect(s.timeout).toBeGreaterThan(0);
      expect(s.timeout).toBeLessThanOrEqual(LIMIT_TIMEOUT_MS);
    }
  });

  it("gives its connection back after a commit, and closes one whose transaction failed, with nothing written", async () => {
    const table = tableAt();
    const limiter = limiterOn(table);
    await limiter.check("ada");
    expect(table.connections).toEqual([{ released: true, destroyed: false }]);

    table.failing = { match: /^COMMIT$/, error: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) };
    await expect(limiter.check("ada")).rejects.toBeInstanceOf(RateLimitUnavailable);
    expect(table.connections?.[1]).toEqual({ released: false, destroyed: true });
    expect([...table.rows.values()][0].hits).toHaveLength(1);
  });

  it("throws RateLimitUnavailable, naming the bucket and the cause, when its database cannot be reached", async () => {
    const table = tableAt();
    table.down = outage();
    const limiter = limiterOn(table, undefined, "auth");
    for (const call of [() => limiter.check("ada"), () => limiter.release("ada"), () => limiter.reset("ada")]) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RateLimitUnavailable);
      expect(err).toMatchObject({ message: "the auth rate limit could not be checked: connect ECONNREFUSED 127.0.0.1:3306", cause: { code: "ECONNREFUSED" } });
    }
  });

  it("gives up waiting for a connection after LIMIT_TIMEOUT_MS, and gives back one that comes later", async () => {
    vi.useFakeTimers();
    const table = tableAt();
    const slow = { getConnection: () => new Promise((resolve) => setTimeout(() => resolve(memoryPool(table).getConnection()), LIMIT_TIMEOUT_MS + 1_000)) };
    const limiter = new RateLimiter("test", { windowMs: MINUTE, max: 3 }, () => slow as unknown as Pool);

    const verdict = limiter.check("ada").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(LIMIT_TIMEOUT_MS);
    expect(await verdict).toMatchObject({ name: "RateLimitUnavailable", cause: { code: "ETIMEDOUT" } });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(table.connections).toEqual([{ released: true, destroyed: false }]);
    expect(table.log).toEqual([]);
  });

  it("gives up on a statement the database does not answer within LIMIT_TIMEOUT_MS, and closes its connection", async () => {
    vi.useFakeTimers();
    const conn = {
      destroyed: false,
      // As mysql2 does: a statement unanswered after its timeout fails.
      query: ({ timeout }: { timeout: number }) =>
        new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("Query inactivity timeout"), { code: "PROTOCOL_SEQUENCE_TIMEOUT" })), timeout)),
      release: vi.fn(),
      destroy() {
        this.destroyed = true;
      },
    };
    const limiter = new RateLimiter("test", { windowMs: MINUTE, max: 3 }, () => ({ getConnection: async () => conn }) as unknown as Pool);

    const verdict = limiter.check("ada").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(LIMIT_TIMEOUT_MS);
    expect(await verdict).toBeInstanceOf(RateLimitUnavailable);
    expect(conn.destroyed).toBe(true);
    expect(conn.release).not.toHaveBeenCalled();
  });

  it("reads a log it cannot make sense of as empty, and writes a good one over it", async () => {
    const table = tableAt(() => T0);
    const limiter = limiterOn(table, { windowMs: MINUTE, max: 2 });
    table.rows.set(`test/${limitSubject("ada")}`, { hits: ["x", null, T0 - 10] as unknown as number[], updatedAt: T0 });
    expect(await limiter.check("ada")).toEqual({ allowed: true, remaining: 0, resetMs: MINUTE });
    expect(table.rows.get(`test/${limitSubject("ada")}`)?.hits).toEqual([T0 - 10, T0]);
  });

  it("refuses a bucket, window or max it cannot keep", () => {
    const ok = { windowMs: MINUTE, max: 3 };
    for (const bucket of ["", "Auth", "1st", "a b", "x".repeat(33)]) expect(() => new RateLimiter(bucket, ok), bucket).toThrow(/bucket/);
    for (const windowMs of [0, 1.5, 24 * 3_600_000 + 1]) expect(() => new RateLimiter("test", { windowMs, max: 3 }), String(windowMs)).toThrow(/window/);
    for (const max of [0, 2.5, 1_001]) expect(() => new RateLimiter("test", { windowMs: MINUTE, max }), String(max)).toThrow(/max/);
  });
});

describe("the sweep of idle rows", () => {
  const DAY = IDLE_HOURS * 3_600_000;
  function seeded() {
    const table = tableAt(() => T0);
    const at = (updatedAt: number) => ({ hits: [], updatedAt });
    table.rows.set("auth/oldest", at(T0 - 3 * DAY));
    table.rows.set("nlq/older", at(T0 - 2 * DAY));
    table.rows.set("api/old", at(T0 - DAY - 1));
    table.rows.set("auth/almost", at(T0 - DAY + 1));
    table.rows.set("scan/fresh", at(T0 - 1_000));
    return table;
  }
  const keys = (table: LimitTable) => [...table.rows.keys()].sort();

  it("deletes the rows idle for a day, oldest first and a batch at a time, and keeps the rest", async () => {
    const table = seeded();
    const sweep = () => sweepIdleRateLimits({ batch: 2, pool: () => memoryPool(table) });
    expect(await sweep()).toBe(2);
    expect(keys(table)).toEqual(["api/old", "auth/almost", "scan/fresh"]);
    expect(await sweep()).toBe(1);
    expect(await sweep()).toBe(0);
    expect(keys(table)).toEqual(["auth/almost", "scan/fresh"]);
    // One read of the idle rows, bounded; then each deleted by its key, if still idle.
    expect(table.log?.slice(0, 3).map((s) => s.values)).toEqual([
      [IDLE_HOURS, 2],
      ["auth", "oldest", IDLE_HOURS],
      ["nlq", "older", IDLE_HOURS],
    ]);
    expect(table.connections?.every((c) => c.released)).toBe(true);
  });

  it("keeps a row a check touched after the sweep read it", async () => {
    const table = seeded();
    table.onStatement = (sql) => {
      if (sql.startsWith("DELETE")) table.rows.set("nlq/older", { hits: [T0], updatedAt: T0 });
    };
    expect(await sweepIdleRateLimits({ pool: () => memoryPool(table) })).toBe(2);
    expect(keys(table)).toEqual(["auth/almost", "nlq/older", "scan/fresh"]);
  });

  it("fails, closing its connection, when the database cannot be reached", async () => {
    const table = seeded();
    table.failing = { match: /^DELETE/, error: outage() };
    await expect(sweepIdleRateLimits({ pool: () => memoryPool(table) })).rejects.toMatchObject({ code: "ECONNREFUSED" });
    expect(table.connections).toEqual([{ released: false, destroyed: true }]);
    table.down = outage();
    await expect(sweepIdleRateLimits({ pool: () => memoryPool(table) })).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });
});

describe("enforceLimit, for tRPC procedures", () => {
  it("lets a request with room through, and refuses one over the limit with TOO_MANY_REQUESTS and the caller's words", async () => {
    const limiter = limiterOn(tableAt(() => T0), { windowMs: MINUTE, max: 1 });
    await expect(enforceLimit(limiter, "ada", (s) => `wait ${s} s`)).resolves.toBeUndefined();
    await expect(enforceLimit(limiter, "ada", (s) => `wait ${s} s`)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", message: "wait 60 s" });
  });

  it("answers a request the limit could not count with SERVICE_UNAVAILABLE, never a refusal", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const table = tableAt();
    table.down = outage();
    await expect(enforceLimit(limiterOn(table), "ada", () => "over")).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: "The rate limit could not be checked just now. Try again in a moment.",
    });
  });
});
