/**
 * The web app's shutdown, in the order that keeps requests from failing on
 * the way down. It stops taking requests first, and lets the requests in
 * flight finish while the database is still there. Closing the pool first
 * answered them 500 ("Can't add new command when connection is in closed
 * state"), in every restart. Then the jobs and the IoT connections stop,
 * both of which still need the database, and the pool closes last.
 */

/** What the HTTP server needs to offer to be closed in order: Node's http.Server. */
export type ClosableServer = {
  close(callback?: (err?: Error) => void): unknown;
  /** Closes connections that carry no request now. Keep-alive connections would otherwise hold close() open. */
  closeIdleConnections?(): void;
  /** Closes every connection, requests in flight included. */
  closeAllConnections?(): void;
};

export type ShutdownSteps = {
  server?: ClosableServer;
  /** Stops the embedded job worker, if any: its job finishes or goes back to the queue. */
  stopJobs?: () => Promise<void>;
  /** Closes the IoT connections and gives up the IoT lease, if held. */
  stopIot?: () => Promise<void>;
  closeDatabase: () => Promise<void>;
  /** How long requests in flight may run on. */
  graceMs: number;
  log?: (message: string) => void;
};

/** Runs the shutdown, and answers the exit code: 0 if every request in flight finished, 1 if some were cut off. */
export async function shutDownInOrder(steps: ShutdownSteps): Promise<number> {
  const log = steps.log ?? ((m: string) => console.log(m));
  let drained = true;
  if (steps.server) {
    const server = steps.server;
    drained = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), steps.graceMs);
      server.close(() => {
        clearTimeout(timer);
        resolve(true);
      });
      server.closeIdleConnections?.();
    });
    if (drained) {
      log("[process] HTTP server closed cleanly.");
    } else {
      log(`[process] Requests still running after ${steps.graceMs} ms were cut off.`);
      server.closeAllConnections?.();
    }
  }
  for (const [what, stop] of [
    ["the embedded job worker", steps.stopJobs],
    ["the IoT connections", steps.stopIot],
  ] as const) {
    try {
      await stop?.();
    } catch (err) {
      log(`[process] Error stopping ${what}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  try {
    await steps.closeDatabase();
    log("[process] Drained and closed MySQL connection pool.");
  } catch (err) {
    log(`[process] Error closing database connection pool: ${err instanceof Error ? err.message : String(err)}`);
  }
  return drained ? 0 : 1;
}
