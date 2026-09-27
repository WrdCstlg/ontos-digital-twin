import { eq } from "drizzle-orm";
import { connectors, iotConnectors } from "@db/schema";
import { getDb } from "../queries/connection";
import { isCredentialField, isSealed, sealCredentials, sealedUnderCurrentKey, secretContext } from "../lib/secretBox";

export type SealingReport = {
  /** Credentials an earlier build stored as plain text, sealed now. */
  sealed: number;
  /** Credentials sealed under another key: unreadable here, and left as they are. */
  otherKey: number;
};

/**
 * Seals every connector credential an earlier build stored as plain text, in
 * SQL and broker connectors alike. The bootstrap runs this on every start,
 * before the app: it changes only plain-text credentials, so a second run
 * changes nothing. Credentials sealed under another key are counted, not
 * touched: only someone who knows them can enter them again.
 */
export async function sealStoredSecrets(): Promise<SealingReport> {
  const db = getDb();
  const report: SealingReport = { sealed: 0, otherKey: 0 };

  /** The settings to store instead, or null when nothing in them needs sealing. */
  const resealed = (config: unknown, context: (field: string) => string): Record<string, unknown> | null => {
    if (!config || typeof config !== "object" || Array.isArray(config)) return null;
    const cfg = config as Record<string, unknown>;
    for (const [field, v] of Object.entries(cfg)) {
      if (isCredentialField(field) && isSealed(v) && !sealedUnderCurrentKey(v)) report.otherKey++;
    }
    const next = sealCredentials(cfg, context);
    const changed = Object.keys(cfg).filter((field) => next[field] !== cfg[field]).length;
    report.sealed += changed;
    return changed > 0 ? next : null;
  };

  for (const row of await db.select().from(connectors)) {
    const next = resealed(row.configJson, (field) => secretContext.connector(row.workspaceId, field));
    if (next) await db.update(connectors).set({ configJson: next }).where(eq(connectors.id, row.id));
  }
  for (const row of await db.select().from(iotConnectors)) {
    const next = resealed(row.configJson, (field) => secretContext.iotConnector(row.workspaceId, field));
    if (next) await db.update(iotConnectors).set({ configJson: next }).where(eq(iotConnectors.id, row.id));
  }
  return report;
}
