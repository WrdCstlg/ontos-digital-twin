/**
 * The rate limits on a real MySQL. rateLimit.test.ts checks the limiter's
 * transactions against an imitation; this checks what they do. Limiters on
 * separate connection pools, as separate API replicas hold them, checking one
 * key at once, let exactly the limit through, and none deadlocks. Every pool
 * counts on the database's clock, whatever its sessions' time zone. A check
 * waits its turn behind a transaction that holds its row, for a bounded time.
 * The sweep deletes only rows idle for a day. And the routes answer 503, never
 * 401 or 429, when the limit cannot be counted or the database cannot be
 * reached, while the limit holds across replicas.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import mysql from "mysql2/promise";
import { sql } from "drizzle-orm";
import { users, workspaceMembers, workspaces } from "@db/schema";
import { closeDb, getDb } from "../../queries/connection";
import { env } from "../../lib/env";
import { hashPassword } from "../../lib/password";
import {
  LIMIT_TIMEOUT_MS,
  RateLimitUnavailable,
  RateLimiter,
  authRateLimiter,
  limitSubject,
  sweepIdleRateLimits,
} from "../../lib/rateLimit";
import { appRouter } from "../../router";
import { publicApi, publicApiRateLimiter } from "../../publicApiRoutes";
import { createToken } from "../../services/publicApi/tokens";
import { createMockContext } from "../testHarness";
import { emptyDatabase } from "./database";

const pools: mysql.Pool[] = [];

/** A pool of its own, as another API replica holds one, its sessions in `zone` when given. */
function replicaPool(zone?: string, uri = process.env.DATABASE_URL!): mysql.Pool {
  const pool = mysql.createPool({ uri, connectionLimit: 10 });
  // Queued on each new connection before anything else it runs.
  if (zone) pool.pool.on("connection", (conn) => conn.query("SET time_zone = ?", [zone], () => undefined));
  pools.push(pool);
  return pool;
}

type Row = { bucket: string; subject: string; hits: number[] };
async function rowsOf(bucket: string): Promise<Row[]> {
  const [rows] = await getDb().execute(sql`select bucket, subject, hits from rate_limit_windows where bucket = ${bucket} order by subject`);
  return rows as unknown as Row[];
}
const rowOf = async (bucket: string, key: string) => (await rowsOf(bucket)).find((r) => r.subject === limitSubject(key));

/** Now on the server's clock, in epoch ms, read in a UTC session, where local time is UTC. */
async function serverNow(pool: mysql.Pool): Promise<number> {
  const [[{ ms }]] = await pool.query<mysql.RowDataPacket[]>("select round(unix_timestamp(now(3)) * 1000) as ms");
  return Number(ms);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => emptyDatabase());
afterEach(async () => {
  await Promise.all(pools.splice(0).map((p) => p.end().catch(() => undefined)));
});
afterAll(() => closeDb());

describe("limiters on separate pools, as separate replicas hold them", () => {
  it("checking one key 100 times at once, let exactly the limit through, each seeing a different count, and none deadlocks", async () => {
    const options = { windowMs: 60_000, max: 10 };
    const replicaA = replicaPool();
    const replicaB = replicaPool();
    const a = new RateLimiter("race", options, () => replicaA);
    const b = new RateLimiter("race", options, () => replicaB);

    // The row missing, so the first checks race to make it; then a row that is there.
    for (const key of ["new@example.com", "known@example.com"]) {
      if (key === "known@example.com") {
        await a.check(key);
        await a.release(key);
        expect((await rowOf("race", key))?.hits).toEqual([]);
      }
      // No catch: a deadlock, a lock wait timeout or any other error fails the test.
      const verdicts = await Promise.all(Array.from({ length: 100 }, (_, i) => (i % 2 ? a : b).check(key)));
      const allowed = verdicts.filter((v) => v.allowed);
      expect(allowed, key).toHaveLength(10);
      // Each check let through saw the count its predecessors left: they took turns.
      expect(allowed.map((v) => v.remaining).sort((x, y) => x - y), key).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const { hits } = (await rowOf("race", key))!;
      expect(hits).toHaveLength(10);
      expect([...hits].sort((x, y) => x - y)).toEqual(hits);
    }
  });

  it("count in one window on the database's clock, whatever their sessions' time zone", async () => {
    const utc = replicaPool("+00:00");
    const east = replicaPool("+13:00");
    const west = replicaPool("-10:00");
    for (const [pool, zone] of [[utc, "+00:00"], [east, "+13:00"], [west, "-10:00"]] as const) {
      const [[{ z }]] = await pool.query<mysql.RowDataPacket[]>("select @@session.time_zone as z");
      expect(z).toBe(zone);
    }
    const on = (pool: mysql.Pool) => new RateLimiter("zones", { windowMs: 60_000, max: 4 }, () => pool);

    const before = await serverNow(utc);
    for (const pool of [east, west, utc, east]) expect((await on(pool).check("ada")).allowed).toBe(true);
    // The fifth is refused through any of them: all four are in one window, and
    // the oldest leaves it a minute after it was let through.
    for (const pool of [utc, east, west]) {
      const refused = await on(pool).check("ada");
      expect(refused).toMatchObject({ allowed: false, remaining: 0 });
      expect(refused.resetMs).toBeGreaterThan(55_000);
      expect(refused.resetMs).toBeLessThanOrEqual(60_000);
    }
    const after = await serverNow(utc);

    // Every time kept is the server's UTC now, not a session's local time.
    const { hits } = (await rowOf("zones", "ada"))!;
    expect(hits).toHaveLength(4);
    for (const t of hits) {
      expect(t).toBeGreaterThanOrEqual(before);
      expect(t).toBeLessThanOrEqual(after);
    }
  });
});

describe("one limiter", () => {
  it("keeps a key only as its SHA-256", async () => {
    await authRateLimiter.check("Ada.Lovelace@example.com");
    const [rows] = await getDb().execute(sql`select bucket, subject, cast(hits as char) as hits from rate_limit_windows`);
    expect(rows).toEqual([{ bucket: "auth", subject: limitSubject("Ada.Lovelace@example.com"), hits: expect.stringMatching(/^\[\d{13}\]$/) }]);
    expect(JSON.stringify(rows)).not.toMatch(/lovelace/i);
  });

  it("release takes back the newest time and reset forgets the key; for a key with none, neither makes a row", async () => {
    const limiter = new RateLimiter("replay", { windowMs: 15 * 60_000, max: 2 });
    await limiter.check("ada");
    await limiter.check("ada");
    expect((await limiter.check("ada")).allowed).toBe(false);
    const [oldest] = (await rowOf("replay", "ada"))!.hits;

    await limiter.release("ada");
    expect((await rowOf("replay", "ada"))!.hits).toEqual([oldest]);
    expect((await limiter.check("ada")).allowed).toBe(true);
    expect((await limiter.check("ada")).allowed).toBe(false);

    await limiter.reset("ada");
    expect(await rowOf("replay", "ada")).toBeUndefined();
    expect((await limiter.check("ada")).allowed).toBe(true);

    await limiter.release("nobody");
    await limiter.reset("nobody");
    expect(await rowOf("replay", "nobody")).toBeUndefined();
  });

  it("waits its turn behind a transaction that holds its row, and goes on when that commits", async () => {
    const limiter = new RateLimiter("held", { windowMs: 60_000, max: 5 });
    await limiter.check("ada");
    const other = await mysql.createConnection(process.env.DATABASE_URL!);
    try {
      await other.query("start transaction");
      await other.query("select hits from rate_limit_windows where bucket = 'held' and subject = ? for update", [limitSubject("ada")]);
      let settled = false;
      const verdict = limiter.check("ada").finally(() => {
        settled = true;
      });
      await sleep(500);
      expect(settled).toBe(false);
      await other.query("commit");
      expect(await verdict).toMatchObject({ allowed: true, remaining: 3 });
    } finally {
      await other.end();
    }
  });

  it("gives up after LIMIT_TIMEOUT_MS behind a transaction that does not let go, counting nothing, and leaves nothing held", async () => {
    const limiter = new RateLimiter("stuck", { windowMs: 60_000, max: 5 });
    await limiter.check("ada");
    const other = await mysql.createConnection(process.env.DATABASE_URL!);
    try {
      await other.query("start transaction");
      await other.query("select hits from rate_limit_windows where bucket = 'stuck' and subject = ? for update", [limitSubject("ada")]);
      const started = Date.now();
      await expect(limiter.check("ada")).rejects.toBeInstanceOf(RateLimitUnavailable);
      const waited = Date.now() - started;
      expect(waited).toBeGreaterThanOrEqual(LIMIT_TIMEOUT_MS - 100);
      expect(waited).toBeLessThan(LIMIT_TIMEOUT_MS + 3_000);
      await other.query("commit");
    } finally {
      await other.end();
    }
    // The abandoned check neither counted nor holds the row now.
    expect(await limiter.check("ada")).toMatchObject({ allowed: true, remaining: 3 });
  });

  it("throws RateLimitUnavailable, promptly, when its pool is closed or its server cannot be reached", async () => {
    const options = { windowMs: 60_000, max: 5 };
    const closed = replicaPool();
    await closed.end();
    await expect(new RateLimiter("away", options, () => closed).check("ada")).rejects.toBeInstanceOf(RateLimitUnavailable);

    const nowhere = replicaPool(undefined, "mysql://root:none@127.0.0.1:1/none");
    const started = Date.now();
    const err = await new RateLimiter("away", options, () => nowhere).check("ada").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitUnavailable);
    expect((err as RateLimitUnavailable).cause).toMatchObject({ code: "ECONNREFUSED" });
    expect(Date.now() - started).toBeLessThan(LIMIT_TIMEOUT_MS + 1_000);
  });
});

describe("the sweep of idle rows", () => {
  const limiter = new RateLimiter("sweep", { windowMs: 60_000, max: 5 });
  /** Moves a row's last use back by `interval`, as if no request had come since. */
  const idleFor = (key: string, interval: string) =>
    getDb().execute(
      sql`update rate_limit_windows set updatedAt = now(3) - interval ${sql.raw(interval)} where bucket = 'sweep' and subject = ${limitSubject(key)}`,
    );
  const left = async () => (await rowsOf("sweep")).map((r) => r.subject).sort();

  it("deletes only the rows idle for a day, oldest first and a batch at a time", async () => {
    for (const key of ["3 days", "2 days", "25 hours", "23 hours", "fresh"]) await limiter.check(key);
    await idleFor("3 days", "3 day");
    await idleFor("2 days", "2 day");
    await idleFor("25 hours", "25 hour");
    await idleFor("23 hours", "23 hour");

    expect(await sweepIdleRateLimits({ batch: 2 })).toBe(2);
    expect(await left()).toEqual(["25 hours", "23 hours", "fresh"].map(limitSubject).sort());
    expect(await sweepIdleRateLimits({ batch: 2 })).toBe(1);
    expect(await sweepIdleRateLimits()).toBe(0);
    expect(await left()).toEqual(["23 hours", "fresh"].map(limitSubject).sort());
  });

  it("keeps a row a request used again, however long it had been idle: every write marks it used", async () => {
    await limiter.check("back");
    await idleFor("back", "2 day");
    await limiter.check("back");
    expect(await sweepIdleRateLimits()).toBe(0);

    // A release that changes the log marks it too.
    await idleFor("back", "2 day");
    await limiter.release("back");
    expect(await sweepIdleRateLimits()).toBe(0);
    expect(await left()).toEqual([limitSubject("back")]);
  });
});

describe("the routes, when the limit cannot be counted, and across replicas", () => {
  const PASSWORD = "Correct-Horse-Battery-2026!";
  const EMAIL = "ada@acme.test";

  beforeEach(async () => {
    const db = getDb();
    await db.insert(workspaces).values({ id: 1, name: "Acme", slug: "acme" });
    await db.insert(users).values({ id: 7, email: EMAIL, name: "Ada", role: "admin", passwordHash: await hashPassword(PASSWORD) });
    await db.insert(workspaceMembers).values({ workspaceId: 1, userId: 7, role: "admin" });
  });

  /** Takes the limits' table away while `during` runs: the database cannot count a request. */
  async function withoutLimits(during: () => Promise<void>) {
    await getDb().execute(sql`rename table rate_limit_windows to rate_limit_windows_away`);
    try {
      await during();
    } finally {
      await getDb().execute(sql`rename table rate_limit_windows_away to rate_limit_windows`);
    }
  }
  const login = (password: string) => appRouter.createCaller(createMockContext({ user: null })).auth.login({ email: EMAIL, password });
  const unavailable = { code: "SERVICE_UNAVAILABLE", message: "Ontos cannot sign you in just now. Try again in a moment." };

  it("signing in answers 503 to the right password and to a wrong one, and the lockout holds across replicas", async () => {
    await expect(login(PASSWORD)).resolves.toMatchObject({ id: 7 });
    const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await withoutLimits(async () => {
      await expect(login(PASSWORD)).rejects.toMatchObject(unavailable);
      await expect(login("wrong")).rejects.toMatchObject(unavailable);
    });
    warned.mockRestore();

    // Five wrong attempts here, five at another replica: the eleventh is refused, whatever its password.
    const replica = replicaPool();
    const elsewhere = new RateLimiter("auth", authRateLimiter.options, () => replica);
    for (let i = 0; i < 5; i++) await expect(login("wrong")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    for (let i = 0; i < 5; i++) expect((await elsewhere.check(EMAIL)).allowed).toBe(true);
    await expect(login(PASSWORD)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("with the database unreachable, signing in and the Ontology API answer 503, never 401 or 429", async () => {
    const { token } = await createToken(1, { name: "Ada", userId: 7, userRole: "admin", memberRole: "admin" }, { name: "CI", role: "viewer", scopes: ["read"] });
    const saved = env.databaseUrl;
    const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await closeDb();
    env.databaseUrl = "mysql://root:none@127.0.0.1:1/none";
    try {
      await expect(login(PASSWORD)).rejects.toMatchObject(unavailable);
      const res = await publicApi.request("/ontology", { headers: { authorization: `Bearer ${token}` } });
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("5");
    } finally {
      await closeDb();
      env.databaseUrl = saved;
      warned.mockRestore();
    }
    await expect(login(PASSWORD)).resolves.toMatchObject({ id: 7 });
  });

  it("the Ontology API answers 503 with retry-after, and holds a token to 300 a minute across replicas", async () => {
    const { token, row } = await createToken(1, { name: "Ada", userId: 7, userRole: "admin", memberRole: "admin" }, { name: "CI", role: "viewer", scopes: ["read"] });
    const get = () => publicApi.request("/ontology", { headers: { authorization: `Bearer ${token}` } });
    expect((await get()).status).toBe(200);

    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await withoutLimits(async () => {
      const res = await get();
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("5");
      expect(await res.json()).toEqual({ error: { code: "unavailable", message: "The rate limit could not be checked just now. Retry in a moment." } });
    });
    // A missing table is no passing outage: it is logged as an error.
    expect(logged).toHaveBeenCalledWith("[api/v1] the rate limit could not be checked:", expect.any(RateLimitUnavailable));
    logged.mockRestore();

    // One request here, 298 at another replica: one more here, then no more.
    const replica = replicaPool();
    const elsewhere = new RateLimiter("api", publicApiRateLimiter.options, () => replica);
    for (let i = 0; i < 298; i += 50) {
      await Promise.all(Array.from({ length: Math.min(50, 298 - i) }, () => elsewhere.check(`token:${row.id}`)));
    }
    const last = await get();
    expect(last.status).toBe(200);
    expect(last.headers.get("x-ratelimit-remaining")).toBe("0");
    const refused = await get();
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
