import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "./queries/connection";
import { jobHandlers } from "./services/jobs/handlers";
import { JobWorker } from "./services/jobs/worker";

/**
 * The Ontos worker: runs background jobs (CSV imports today) from the queue in
 * MySQL, apart from the web app. Any number can run against one database; each
 * uses its own semantic engine (OPEN_ONTOLOGIES_URL), because the engine holds
 * one graph at a time and its lock lives in the process using it.
 *
 * GET /health on WORKER_PORT (default 3001) answers 200 while the job loop is
 * alive and the database answers, 503 otherwise.
 */

const POLL_MS = 1000;

const worker = new JobWorker({
  handlers: jobHandlers,
  pollMs: POLL_MS,
  version: process.env.ONTOS_VERSION ?? null,
});
worker.start();

const health = new Hono();
health.get("/health", async (c) => {
  const s = worker.status();
  // A loop that is busy with a job has not polled lately, and that is fine.
  const loopAlive = s.state === "running" && (s.currentJobId !== null || Date.now() - s.lastLoopAt < 10 * POLL_MS);
  let database = "connected";
  try {
    await getDb().execute(sql`SELECT 1`);
  } catch {
    database = "disconnected";
  }
  const ok = loopAlive && database === "connected";
  return c.json(
    {
      status: ok ? "ok" : "error",
      worker: s.id,
      state: s.state,
      currentJobId: s.currentJobId,
      jobsSucceeded: s.succeeded,
      jobsFailed: s.failed,
      lastLoopAgoMs: s.lastLoopAt ? Date.now() - s.lastLoopAt : null,
      database,
    },
    ok ? 200 : 503,
  );
});

const port = Number(process.env.WORKER_PORT || 3001);
const server = serve({ fetch: health.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`[worker] ${worker.id} running; health on :${port}/health`);
});

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] ${signal}: finishing the current job (up to 5 s), then exiting`);
  // A job still running after the grace period is aborted and goes back to the
  // queue, so another worker (or this one, restarted) picks it up.
  await worker.stop(5000);
  server.close();
  await closeDb().catch(() => undefined);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
