/**
 * The audit log's hash chains on a real MySQL. Appends take turns on the one
 * row of audit_chain_lock: appends made at once, to one workspace's chain or
 * to several, alone or at the end of transactions that locked other rows
 * first (as an action submission's does), neither deadlock nor fork a chain.
 * Under the append this replaced, they deadlocked.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { auditChainLock, auditLog, kgNodes, workspaces } from "@db/schema";
import { closeDb, getDb } from "../../queries/connection";
import { auditRecord, verifyAuditChain, writeAudit } from "../../services/audit";
import { emptyDatabase } from "./database";

const A = 1;
const B = 2;

beforeEach(async () => {
  await emptyDatabase();
  await getDb().insert(workspaces).values([
    { id: A, name: "A", slug: "a" },
    { id: B, name: "B", slug: "b" },
  ]);
});
afterAll(() => closeDb());

const entry = (workspaceId: number, i: number) => ({ workspaceId, actor: "test", action: `entry ${i}`, entityType: "test", entityId: i });
const entries = (workspaceId: number) => getDb().select().from(auditLog).where(eq(auditLog.workspaceId, workspaceId)).orderBy(auditLog.id);

describe("appends to an audit chain", () => {
  it("made at once, many of them, neither deadlock nor fork the chain", async () => {
    // No retry: a deadlock fails the test.
    await Promise.all(Array.from({ length: 40 }, (_, i) => writeAudit(entry(A, i))));

    const chain = await entries(A);
    expect(chain).toHaveLength(40);
    expect(chain[0].prevHash).toBeNull();
    chain.slice(1).forEach((e, i) => expect(e.prevHash, `entry ${e.id}`).toBe(chain[i].hash));
    expect(await verifyAuditChain(A)).toBe(true);
  });

  it("nor at the end of transactions that locked other rows first, as an action submission's does", async () => {
    await getDb()
      .insert(kgNodes)
      .values(Array.from({ length: 20 }, (_, i) => ({ id: i + 1, workspaceId: A, moduleKey: "hr", classIri: "hr:Person", iri: `hr:person/${i}`, label: `Person ${i}` })));

    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        getDb().transaction(async (tx) => {
          await tx.select().from(kgNodes).where(inArray(kgNodes.id, [(i % 20) + 1, ((i * 7) % 20) + 1])).for("update");
          await writeAudit(entry(A, i), tx);
        }),
      ),
    );

    expect(await entries(A)).toHaveLength(30);
    expect(await verifyAuditChain(A)).toBe(true);
  });

  it("to two workspaces at once keep each chain its own, each beginning afresh", async () => {
    await Promise.all(Array.from({ length: 30 }, (_, i) => writeAudit(entry(i % 2 ? A : B, i))));

    for (const ws of [A, B]) {
      const chain = await entries(ws);
      expect(chain, `workspace ${ws}`).toHaveLength(15);
      expect(chain[0].prevHash).toBeNull();
      expect(await verifyAuditChain(ws)).toBe(true);
    }
  });

  it("go on from where a chain written directly ended, and make the lock row again when it is gone", async () => {
    // The seed writes its chain directly; and emptyDatabase took the lock row too.
    let prevHash: string | null = null;
    for (let i = 0; i < 3; i++) {
      const { payloadJson, hash } = auditRecord(prevHash, { actor: "seed", action: `seeded ${i}`, entityType: "test", entityId: i });
      await getDb().insert(auditLog).values({ workspaceId: A, actorLabel: "seed", action: `seeded ${i}`, entityType: "test", entityId: String(i), payloadJson, hash, prevHash });
      prevHash = hash;
    }
    expect(await getDb().select().from(auditChainLock)).toEqual([]);

    await Promise.all([writeAudit(entry(A, 10)), writeAudit(entry(A, 11))]);

    expect(await getDb().select().from(auditChainLock)).toEqual([{ id: 1 }]);
    const chain = await entries(A);
    expect(chain).toHaveLength(5);
    expect(chain[3].prevHash).toBe(prevHash);
    expect(await verifyAuditChain(A)).toBe(true);
  });

  it("an append rolled back with its transaction leaves the chain as it was", async () => {
    await writeAudit(entry(A, 1));
    await expect(
      getDb().transaction(async (tx) => {
        await writeAudit(entry(A, 2), tx);
        throw new Error("the change it records failed");
      }),
    ).rejects.toThrow("the change it records failed");
    await writeAudit(entry(A, 3));

    expect((await entries(A)).map((e) => e.action)).toEqual(["entry 1", "entry 3"]);
    expect(await verifyAuditChain(A)).toBe(true);
  });
});

describe("migration 0008", () => {
  it("makes the lock row", async () => {
    const migration = readFileSync(path.resolve(import.meta.dirname, "../../../db/migrations/0008_audit_chain_lock.sql"), "utf8");
    const insert = migration.split("--> statement-breakpoint").find((s) => /insert into `audit_chain_lock`/i.test(s));
    expect(insert).toBeDefined();

    await getDb().execute(sql.raw(insert!));

    expect(await getDb().select().from(auditChainLock)).toEqual([{ id: 1 }]);
  });
});
