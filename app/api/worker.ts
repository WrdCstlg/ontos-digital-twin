import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { sql } from "drizzle-orm";
import { closeDb, getDb, openConnection } from "./queries/connection";
import { env } from "./lib/env";
import { secretKey } from "./lib/secretBox";
import { engineLockName, installEngineLock } from "./services/engineLock";
import { jobHandlers } from "./services/jobs/handlers";
import { JobWorker } from "./services/jobs/worker";
import { iotConsumerEnabled, startIotConsumer } from "./services/iot/iotConsumer";
import { semanticEngine } from "./services/semanticEngine";

/**
 * The Ontos worker: runs background jobs (CSV imports today) from the queue in
 * MySQL, apart from the web app. Any number can run against one database.
 * Replicas may share one semantic engine (OPEN_ONTOLOGIES_URL; compose.yaml
 * gives every replica engine-worker): the engine holds one graph at a time, so
 * each engine task takes a MySQL named lock, one per engine and database, that
 * every replica takes too (services/engineLock.ts). The app never takes it, so
 * a worker must not share the app's engine.
 *
 * It also runs the IoT consumer, unless ONTOS_IOT_CONSUMER=false: of all the
 * processes that run one, the one holding its lease connects to the brokers.
 *
 * GET /health on WORKER_PORT (default 3001) answers 200 while the job loop is
 * alive and the database answers, 503 otherwise.
 */

const POLL_MS = 1000;

// SQL imports open the source's sealed password (lib/secretBox.ts): a
// malformed SECRETS_KEY stops the worker here, before it takes any job.
try {
  secretKey();
} catch (err) {
  console.error(`[secrets] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

installEngineLock(semanticEngine, {
  connect: openConnection,
  name: engineLockName(env.databaseUrl, semanticEngine.getUrl(), process.env.ENGINE_LOCK_KEY),
});

const worker = new JobWorker({
  handlers: jobHandlers,
  pollMs: POLL_MS,
  version: process.env.ONTOS_VERSION ?? null,
});
worker.start();

// It holds the IoT lease under the worker's own name, the one its row in `workers` has.
const iot = iotConsumerEnabled(true) ? await startIotConsumer({ owner: worker.id }) : null;

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
      // Whether this worker is the one connected to the brokers: informative,
      // since only one worker holds the IoT lease at a time.
      iot: iot ? { holdsLease: iot.status().holdsLease, connections: iot.status().connections } : null,
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
  console.log(`[worker] ${signal}: finishing the current job (up to 5 s, and its engine requests their own timeouts), then exiting`);
  // A job still running after the grace period is aborted and goes back to the
  // queue, so another worker (or this one, restarted) picks it up. One with an
  // engine request on its way ends when the engine has answered it.
  await worker.stop(5000);
  // Its connections closed and its lease released: another worker takes over at once.
  await iot?.stop().catch((err) => console.error("[worker] stopping the IoT consumer failed:", err));
  server.close();
  await closeDb().catch(() => undefined);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
