import { createHash } from "crypto";
import { desc, eq } from "drizzle-orm";
import { auditLog, workspaces } from "@db/schema";
import type { User } from "@db/schema";
import { getDb } from "../queries/connection";

export const DEMO_WORKSPACE_SLUG = "acme-corp-production";

/** Resolve the demo workspace (single-tenant demo). Throws if not seeded. */
export async function getDemoWorkspace() {
  const db = getDb();
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, DEMO_WORKSPACE_SLUG))
    .limit(1);
  if (!ws) {
    const [any] = await db.select().from(workspaces).limit(1);
    if (!any) throw new Error("No workspace seeded — run db/seed.ts");
    return any;
  }
  return ws;
}

/** Stable JSON stringify (sorted keys) for hash-chain canonical payloads. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`)
    .join(",")}}`;
}

export function auditHash(prevHash: string | null, canonicalPayload: string) {
  return createHash("sha256")
    .update((prevHash ?? "") + canonicalPayload)
    .digest("hex");
}

export function actorLabelFor(user?: User): string {
  return user?.name?.trim() || user?.email || "anonymous (demo)";
}

export type AuditFields = {
  actor: string;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  payload?: unknown;
};

/**
 * The payload an entry stores and the hash that chains it. The hash is taken
 * over the payload as the JSON column will hold it: undefined members dropped,
 * dates as strings. Hashing the value before that round trip would chain
 * something verifyAuditChain can never read back.
 */
export function auditRecord(prevHash: string | null, f: AuditFields): { payloadJson: Record<string, unknown>; hash: string } {
  const payloadJson = JSON.parse(
    JSON.stringify({
      actor: f.actor,
      action: f.action,
      entityType: f.entityType,
      entityId: f.entityId ?? null,
      payload: f.payload ?? null,
    }),
  ) as Record<string, unknown>;
  return { payloadJson, hash: auditHash(prevHash, canonicalize(payloadJson)) };
}

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Append a hash-chained audit entry. Returns the inserted row. Given `inTx`,
 * the entry is written inside that transaction, so it commits or rolls back
 * with the change it records.
 */
export async function writeAudit(opts: AuditFields & { workspaceId: number }, inTx?: Tx) {
  const write = async (tx: Tx) => {
    const [last] = await tx
      .select()
      .from(auditLog)
      .where(eq(auditLog.workspaceId, opts.workspaceId))
      .orderBy(desc(auditLog.id))
      .limit(1)
      .for("update");

    const prevHash = last?.hash ?? null;
    const { payloadJson, hash } = auditRecord(prevHash, opts);
    const [{ id }] = await tx
      .insert(auditLog)
      .values({
        workspaceId: opts.workspaceId,
        actorLabel: opts.actor,
        action: opts.action,
        entityType: opts.entityType,
        entityId: opts.entityId != null ? String(opts.entityId) : null,
        payloadJson,
        hash,
        prevHash,
      })
      .$returningId();
    const [row] = await tx.select().from(auditLog).where(eq(auditLog.id, id));
    return row;
  };
  return inTx ? write(inTx) : getDb().transaction(write);
}

/** Recompute the hash chain; returns true if intact. */
export async function verifyAuditChain(workspaceId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.workspaceId, workspaceId))
    .orderBy(auditLog.id);
  let prev: string | null = null;
  for (const row of rows) {
    const payload = row.payloadJson as Record<string, unknown> | null;
    const canonicalPayload = canonicalize({
      actor: payload?.actor ?? row.actorLabel,
      action: payload?.action ?? row.action,
      entityType: payload?.entityType ?? row.entityType,
      entityId: payload?.entityId ?? row.entityId ?? null,
      payload: payload?.payload ?? null,
    });
    const expected = auditHash(prev, canonicalPayload);
    if (row.prevHash !== prev || row.hash !== expected) return false;
    prev = row.hash;
  }
  return true;
}
