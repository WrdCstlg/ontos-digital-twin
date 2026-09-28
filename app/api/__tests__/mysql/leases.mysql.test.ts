/**
 * Leases on a real MySQL (services/leases.ts). leases.test.ts checks the
 * keeper against a fake store; this checks the SQL: processes on two pools,
 * one of whose sessions runs in another time zone, race for a lease and
 * exactly one holds it; it lapses on the database's clock, and the process
 * that takes it over gets a higher generation; a holder that lost it can
 * neither renew nor release it, and its fence refuses; and a fence holds a
 * takeover off until the fenced transaction ends.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import * as relations from "@db/relations";
import { leases, workspaces } from "@db/schema";
import { closeDb, getDb } from "../../queries/connection";
import { fence, mysqlLeases, type Lease } from "../../services/leases";
import { emptyDatabase } from "./database";

const NAME = "iot-consumer";

// A second process's pool. Its sessions run nine hours off the server's, so a
// time the lease took from a session's clock, not the database's, would show.
const otherPool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 10 });
otherPool.on("connection", (conn) => void conn.query("SET time_zone = '+09:00'"));
const otherDb = drizzle(otherPool, { schema: { ...schema, ...relations }, mode: "default" }) as unknown as ReturnType<typeof getDb>;

const here = mysqlLeases();
const there = mysqlLeases(() => otherDb);

beforeEach(async () => {
  await emptyDatabase();
});
afterAll(async () => {
  await otherPool.end();
  await closeDb();
});

const row = async () => (await getDb().select().from(leases).where(eq(leases.name, NAME)))[0];
/** Milliseconds from the database's now to the lease's expiry. */
const msLeft = async () =>
  Number((await getDb().select({ ms: sql<number>`timestampdiff(microsecond, now(3), ${leases.expiresAt}) div 1000` }).from(leases).where(eq(leases.name, NAME)))[0].ms);

describe("taking a lease", () => {
  it("processes racing for it, on two pools, never both hold it: in every round exactly one does, one generation up", async () => {
    for (let round = 1; round <= 15; round++) {
      // Five attempts from each pool at once; the first round makes the row.
      const attempts = await Promise.all(
        Array.from({ length: 10 }, (_, i) => (i % 2 ? there : here).acquire(NAME, `p${i}`, 15_000)),
      );
      const won = attempts.filter((l): l is Lease => l !== null);
      expect(won, `round ${round}`).toHaveLength(1);
      expect(won[0].generation).toBe(round);
      expect(await row()).toMatchObject({ owner: won[0].owner, generation: round });
      expect(await here.release(won[0])).toBe(true);
    }
  });

  it("lasts as long as asked, on the database's clock, whatever the session's time zone", async () => {
    const lease = await there.acquire(NAME, "b", 15_000);
    expect(lease).not.toBeNull();
    const left = await msLeft();
    expect(left).toBeGreaterThan(14_000);
    expect(left).toBeLessThanOrEqual(15_000);
    expect(await here.acquire(NAME, "a", 15_000)).toBeNull();
  });

  it("gives the generation it took back from the database: the one the row holds", async () => {
    await getDb().insert(leases).values({ name: NAME, generation: 41 });
    const lease = await here.acquire(NAME, "a", 15_000);
    expect(lease).toEqual({ name: NAME, owner: "a", generation: 42 });
    expect((await row()).generation).toBe(42);
  });
});

describe("a lease lapses, and changes hands", () => {
  it("not renewed, it lapses on the database's clock, and another process takes it with a higher generation", async () => {
    const a = await here.acquire(NAME, "a", 400);
    expect(a?.generation).toBe(1);
    expect(await there.acquire(NAME, "b", 15_000)).toBeNull();
    await new Promise((r) => setTimeout(r, 600));
    const b = await there.acquire(NAME, "b", 15_000);
    expect(b).toEqual({ name: NAME, owner: "b", generation: 2 });
  });

  it("the holder that lost it can neither renew it nor release it, and its fence refuses: the new holder's passes", async () => {
    const a = (await here.acquire(NAME, "a", 15_000))!;
    await getDb().update(leases).set({ expiresAt: sql`now(3) - interval 1 second` }).where(eq(leases.name, NAME));
    const b = (await there.acquire(NAME, "b", 15_000))!;

    expect(await here.renew(a, 15_000)).toBe(false);
    expect(await here.release(a)).toBe(false);
    expect(await getDb().transaction((tx) => fence(tx, a))).toBe(false);
    expect(await getDb().transaction((tx) => fence(tx, b))).toBe(true);
    expect(await row()).toMatchObject({ owner: "b", generation: 2 });
  });

  it("while held, renewing keeps it, even twice within a millisecond: the match counts, not the change", async () => {
    const a = (await here.acquire(NAME, "a", 60_000))!;
    expect(await here.renew(a, 60_000)).toBe(true);
    expect(await here.renew(a, 60_000)).toBe(true);
    expect(await msLeft()).toBeGreaterThan(59_000);
  });

  it("released, it is free at once, and the next process takes it one generation up", async () => {
    const a = (await here.acquire(NAME, "a", 60_000))!;
    expect(await here.release(a)).toBe(true);
    expect(await row()).toMatchObject({ owner: null, expiresAt: null, generation: 1 });
    expect(await there.acquire(NAME, "b", 60_000)).toEqual({ name: NAME, owner: "b", generation: 2 });
  });
});

describe("a fence", () => {
  it("holds a takeover off until the fenced transaction ends, so what it writes commits under the lease", async () => {
    await getDb().insert(workspaces).values({ id: 1, name: "A", slug: "a" });
    const a = (await here.acquire(NAME, "a", 300))!;
    const order: string[] = [];
    let takeover: Promise<Lease | null> | undefined;
    await getDb().transaction(async (tx) => {
      expect(await fence(tx, a)).toBe(true);
      // The lease runs out while the fenced work goes on...
      await new Promise((r) => setTimeout(r, 500));
      takeover = there.acquire(NAME, "b", 15_000).then((l) => (order.push("taken over"), l));
      await new Promise((r) => setTimeout(r, 500));
      // ...and the takeover waits for it: the work still writes under the lease.
      await tx.update(workspaces).set({ name: "written under a" }).where(eq(workspaces.id, 1));
      order.push("fenced work committed");
    });
    const b = await takeover;
    expect(order).toEqual(["fenced work committed", "taken over"]);
    expect(b?.generation).toBe(2);
    expect((await getDb().select().from(workspaces))[0].name).toBe("written under a");
    // Once taken over, the old holder's fence refuses.
    expect(await getDb().transaction((tx) => fence(tx, a))).toBe(false);
  });
});
