import { eq } from "drizzle-orm";
import { syncJobs } from "@db/schema";
import { getDb } from "../queries/connection";

/**
 * Marks every sync job still `running` as `failed`, and returns how many.
 *
 * An import runs inside the request that started it, so a freshly started app
 * process has none in progress, and Ontos runs one app process per database. A
 * job still `running` at startup therefore belonged to a process that stopped
 * mid-import (a crash, a kill, or a shutdown that closed the database under
 * it). Nothing will ever finish it, and left alone it reads as in progress
 * forever.
 *
 * Call once at startup, before the server accepts a request: run later, it
 * would fail imports this process is actually running.
 */
export async function failAbandonedSyncJobs(): Promise<number> {
  const [result] = await getDb()
    .update(syncJobs)
    .set({ status: "failed", finishedAt: new Date() })
    .where(eq(syncJobs.status, "running"));
  return result.affectedRows;
}
