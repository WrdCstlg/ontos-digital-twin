import { jobHandlers } from "./handlers";
import { JobWorker } from "./worker";

/**
 * Background jobs run in a dedicated worker process in the Docker stack
 * (dist/worker.js). For local development one process is simpler, so the web
 * app runs a worker of its own when this says so: always under
 * ONTOS_EMBEDDED_WORKER=true, by default in development, never under tests.
 */
export function embeddedWorkerEnabled(): boolean {
  const flag = process.env.ONTOS_EMBEDDED_WORKER;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV === "development";
}

// A dev-server reload re-runs the module that starts the worker; the previous
// worker must be stopped, or each reload would leave another one polling.
const holder = globalThis as typeof globalThis & { __ontosEmbeddedWorker?: JobWorker };

export async function startEmbeddedWorker(): Promise<JobWorker> {
  await holder.__ontosEmbeddedWorker?.stop(2000);
  const worker = new JobWorker({ handlers: jobHandlers, version: process.env.ONTOS_VERSION ?? null });
  holder.__ontosEmbeddedWorker = worker;
  worker.start();
  return worker;
}

export function embeddedWorker(): JobWorker | undefined {
  return holder.__ontosEmbeddedWorker;
}
