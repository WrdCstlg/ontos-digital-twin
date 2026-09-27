import { eq } from "drizzle-orm";
import { connectors, iotConnectors } from "@db/schema";
import { getDb } from "../queries/connection";
import {
  connectorEndpoint,
  isCredentialField,
  isSealed,
  openSecret,
  sealSecret,
  sealedUnderCurrentKey,
  sealedUnderKnownKey,
  secretContext,
  SecretUnreadableError,
  secretKey,
} from "../lib/secretBox";

export type SealingReport = {
  /** Credentials an earlier build stored as plain text, sealed now. */
  sealed: number;
  /** Credentials sealed under a key the current one replaced, sealed again under the current one. */
  resealed: number;
  /** Credentials this server cannot open (another key, or damaged): left as they are. */
  unreadable: number;
};

/**
 * Brings every stored connector credential under the current key, in SQL and
 * broker connectors alike: plain text an earlier build stored is sealed, and a
 * value sealed under a key the current one replaced (the key derived from
 * APP_SECRET once SECRETS_KEY is set, or SECRETS_KEY_PREVIOUS) is sealed again.
 * The bootstrap runs this on every start, before the app; a second run changes
 * nothing. Credentials it cannot open are counted, not touched: only someone
 * who knows them can enter them again.
 */
export async function sealStoredSecrets(): Promise<SealingReport> {
  secretKey(); // a malformed key fails here, before anything is read
  const db = getDb();
  const report: SealingReport = { sealed: 0, resealed: 0, unreadable: 0 };

  /** The settings to store instead, or null when nothing in them changes. */
  const brought = (config: unknown, context: (field: string) => string): Record<string, unknown> | null => {
    if (!config || typeof config !== "object" || Array.isArray(config)) return null;
    const next: Record<string, unknown> = { ...(config as Record<string, unknown>) };
    let changed = false;
    for (const [field, v] of Object.entries(next)) {
      if (!isCredentialField(field) || typeof v !== "string" || v.length === 0) continue;
      if (!isSealed(v)) {
        next[field] = sealSecret(v, context(field));
        report.sealed++;
        changed = true;
      } else if (!sealedUnderCurrentKey(v)) {
        if (!sealedUnderKnownKey(v)) {
          report.unreadable++;
          continue;
        }
        try {
          next[field] = sealSecret(openSecret(v, context(field)), context(field));
          report.resealed++;
          changed = true;
        } catch (err) {
          if (!(err instanceof SecretUnreadableError)) throw err;
          report.unreadable++;
        }
      }
    }
    return changed ? next : null;
  };

  for (const row of await db.select().from(connectors)) {
    const cfg = (row.configJson ?? {}) as Record<string, unknown>;
    const endpoint = connectorEndpoint(cfg);
    const next = brought(row.configJson, (field) => secretContext.connector(row.workspaceId, field, endpoint));
    if (next) await db.update(connectors).set({ configJson: next }).where(eq(connectors.id, row.id));
  }
  for (const row of await db.select().from(iotConnectors)) {
    const next = brought(row.configJson, (field) => secretContext.iotConnector(row.workspaceId, field, row.endpointUrl));
    if (next) await db.update(iotConnectors).set({ configJson: next }).where(eq(iotConnectors.id, row.id));
  }
  return report;
}
