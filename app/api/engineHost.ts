import "dotenv/config";
import { serve } from "@hono/node-server";
import { ConfigError, findEngineBinary, readHostConfig, type HostConfig } from "./services/engineHost/config";
import { DataRootError } from "./services/engineHost/dataRoot";
import { message } from "./services/engineHost/errors";
import { EngineHost } from "./services/engineHost/host";
import { runSelfTest } from "./services/engineHost/selfTest";
import { createHostApp } from "./services/engineHost/server";

/**
 * The Ontos engine host: the only process that runs open-ontologies for
 * workspaces. It keeps one persistent engine per workspace, starting it on
 * demand and stopping it when idle, and proxies a small HTTP API to it
 * (services/engineHost/server.ts). Not used by the app or the worker yet.
 *
 *   node dist/engineHost.js              serve, configured by ENGINE_HOST_* (README)
 *   node dist/engineHost.js --self-test  start one scratch engine, load, validate,
 *                                        reason; exit 0 when all of it worked
 */

const SHUTDOWN_DEADLINE_MS = 25_000;

function fail(line: string): never {
  console.error(`[engine-host] ${line}`);
  process.exit(1);
}

/**
 * Ends the process with `code` once nothing is left to run. Not process.exit()
 * at once: right after a fetch, on Windows, that can trip a libuv assertion.
 * Bounded all the same, should a handle linger.
 */
function exitWhenIdle(code: number): void {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 5_000).unref();
}

async function selfTest(): Promise<number> {
  let binPath: string | null;
  try {
    binPath = findEngineBinary();
  } catch (err) {
    console.error(`[engine-host] self-test: ${message(err)}`);
    return 1;
  }
  if (!binPath) {
    console.error("[engine-host] self-test: no open-ontologies binary found (ENGINE_HOST_BIN, OPEN_ONTOLOGIES_BIN)");
    return 1;
  }
  return (await runSelfTest(binPath)) ? 0 : 1;
}

async function serveHost(): Promise<void> {
  let config: HostConfig;
  try {
    config = readHostConfig();
  } catch (err) {
    fail(err instanceof ConfigError ? err.message : `configuration: ${message(err)}`);
  }

  let host: EngineHost;
  try {
    host = await EngineHost.create(config);
  } catch (err) {
    fail(err instanceof DataRootError ? err.message : `could not open ${config.dataDir}: ${message(err)}`);
  }

  const app = createHostApp(host, { token: config.token });
  const server = serve(
    {
      fetch: app.fetch,
      port: config.port,
      hostname: config.bind,
      serverOptions: {
        // A load's body may take a while to arrive; nothing else takes as long.
        requestTimeout: config.timeouts.load,
        headersTimeout: 60_000,
      },
    },
    (info) => {
      console.log(
        `[engine-host] listening on ${config.bind}:${info.port}; stores under ${config.dataDir}; ` +
          `up to ${config.maxEngines} engines, idle stop after ${Math.round(config.idleMs / 1000)} s, ` +
          `${config.scratchEngines} scratch engine(s)` +
          (config.token ? "" : "; DEV MODE: no token required, loopback only"),
      );
    },
  );

  let stopping = false;
  const shutdown = async (why: string, code: number) => {
    if (stopping) return;
    stopping = true;
    console.log(`[engine-host] ${why}: no new requests; stopping every engine (stores stay on disk)`);
    setTimeout(() => {
      console.error(`[engine-host] shutdown took longer than ${SHUTDOWN_DEADLINE_MS} ms; exiting anyway`);
      process.exit(1);
    }, SHUTDOWN_DEADLINE_MS).unref();
    server.close();
    try {
      await host.close(5000);
    } catch (err) {
      console.error(`[engine-host] stopping engines failed: ${message(err)}`);
      code = 1;
    }
    console.log("[engine-host] stopped");
    exitWhenIdle(code);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM", 0));
  process.on("SIGINT", () => void shutdown("SIGINT", 0));
  // A bug, not a request's failure: stop the engines rather than leave them
  // holding their stores for a host that no longer answers.
  process.on("uncaughtException", (err) => {
    console.error("[engine-host] uncaught exception:", err);
    void shutdown("uncaught exception", 1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[engine-host] unhandled promise rejection:", reason);
  });
}

if (process.argv.includes("--self-test")) {
  exitWhenIdle(await selfTest());
} else {
  await serveHost();
}
