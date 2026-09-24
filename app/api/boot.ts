import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";

import { randomUUID, timingSafeEqual } from "node:crypto";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";

import { sql } from "drizzle-orm";
import { getDb } from "./queries/connection";
import { semanticEngine } from "./services/semanticEngine";
import { authenticateRequest } from "./auth/service";
import { sparqlRateLimiter } from "./lib/rateLimit";
import { isReadOnlySparql, MAX_SPARQL_LENGTH } from "./lib/sparqlGuard";
import { resolveUserWorkspace } from "./services/workspaceGuard";

const app = new Hono<{ Bindings: HttpBindings }>();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// Security Headers (OWASP A02: Security Misconfiguration)
app.use(
  "*",
  secureHeaders({
    xFrameOptions: "DENY",
    xContentTypeOptions: "nosniff",
    referrerPolicy: "strict-origin-when-cross-origin",
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    xXssProtection: "1; mode=block",
  }),
);

// Explicit Origin Whitelist CORS (OWASP A02)
app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return "";
      // In development or local testing, allow localhost origins
      if (
        !env.isProduction &&
        (origin.startsWith("http://localhost:") ||
          origin.startsWith("http://127.0.0.1:") ||
          origin.startsWith("https://localhost:"))
      ) {
        return origin;
      }
      // In production, validate against explicitly configured allowed origins
      if (allowedOrigins.includes(origin)) {
        return origin;
      }
      // Disallow all other origins
      return "";
    },
    credentials: true,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-trpc-source", "x-request-id"],
    maxAge: 86400,
  }),
);

// CSRF Protection on mutating requests (OWASP A08)
app.use(
  "*",
  csrf({
    origin: (origin, c) => {
      if (!origin) return false;
      try {
        const reqOrigin = new URL(c.req.url).origin;
        if (origin === reqOrigin) return true;
      } catch {
        // malformed URL
      }
      if (
        !env.isProduction &&
        (origin.startsWith("http://localhost:") ||
          origin.startsWith("http://127.0.0.1:") ||
          origin.startsWith("https://localhost:"))
      ) {
        return true;
      }
      return allowedOrigins.includes(origin);
    },
  }),
);

// Request Tracing ID
app.use("*", async (c, next) => {
  const reqId = c.req.header("x-request-id") || randomUUID();
  c.header("x-request-id", reqId);
  await next();
});

// Enforce 2MB Body Limit (CVE-2026-Node HTTP/2 DoS & memory exhaustion mitigation)
app.use(bodyLimit({ maxSize: 2 * 1024 * 1024 }));

// Health Check Endpoint (OWASP A09: Security Logging & Monitoring)
// Registered at both paths (not a redirect to /health) because the Vite dev
// server only proxies /api/* to this Hono app (see vite.config.ts's `exclude`);
// a redirect target outside that scope would resolve to the SPA shell in dev.
const healthCheck = async (c: Context<{ Bindings: HttpBindings }>) => {
  try {
    const db = getDb();
    await db.execute(sql`SELECT 1`);
    const engineHealth = await semanticEngine.checkHealth();
    return c.json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: "connected",
      semanticEngine: {
        status: engineHealth.alive ? "connected" : "offline",
        version: engineHealth.version,
        url: engineHealth.url,
        latencyMs: engineHealth.latencyMs,
      },
    });
  } catch (err) {
    return c.json(
      {
        status: "error",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        database: "disconnected",
        error: err instanceof Error ? err.message : "Database check failed",
      },
      503,
    );
  }
};
app.get("/health", healthCheck);
app.get("/api/health", healthCheck);

// SPARQL 1.1 Query Endpoint — authenticated, rate limited, read-only.
// This route sits outside the tRPC pipeline, so it performs the session check
// that `authedQuery` would otherwise apply.
app.post("/api/sparql", async (c) => {
  let user;
  try {
    user = await authenticateRequest(c.req.raw.headers);
  } catch {
    return c.json({ error: "Authentication required." }, 401);
  }

  let workspace;
  try {
    const resolved = await resolveUserWorkspace(user, c.req.raw.headers);
    workspace = resolved.workspace;
  } catch {
    return c.json({ error: "Forbidden: No authorized workspace membership." }, 403);
  }

  const limit = sparqlRateLimiter.check(`sparql:${user.id}`);
  if (!limit.allowed) {
    c.header("retry-after", String(Math.ceil(limit.resetMs / 1000)));
    return c.json({ error: "Rate limit exceeded. Try again shortly." }, 429);
  }

  let queryText = "";
  const contentType = c.req.header("content-type") || "";
  if (contentType.includes("application/sparql-query")) {
    queryText = await c.req.text();
  } else if (contentType.includes("application/json")) {
    const body = (await c.req.json().catch(() => ({}))) as { query?: string };
    queryText = body.query || "";
  } else {
    const body = (await c.req.parseBody().catch(() => ({}))) as { query?: unknown };
    queryText = String(body.query || "");
  }

  if (!queryText.trim()) {
    return c.json({ error: "Missing SPARQL query string (parameter 'query')" }, 400);
  }

  if (queryText.length > MAX_SPARQL_LENGTH) {
    return c.json(
      { error: `SPARQL query exceeds the ${MAX_SPARQL_LENGTH} character limit.` },
      400,
    );
  }

  if (!isReadOnlySparql(queryText)) {
    return c.json(
      {
        error:
          "Only read-only SPARQL queries are accepted here (SELECT, ASK, CONSTRUCT, DESCRIBE).",
      },
      400,
    );
  }

  const isAlive = await semanticEngine.ensureEngineRunning();
  if (!isAlive) {
    return c.json(
      { error: "Semantic engine is currently unavailable. Ensure open-ontologies service is active." },
      503,
    );
  }

  // The engine holds one graph at a time, so the sync and the query run together
  // under its lock. By default the workspace is re-synced first so answers are
  // current. x-auto-sync: false skips the re-sync only when the store already
  // holds this workspace (e.g. repeated queries in one batch) — never another's.
  const resync = c.req.header("x-auto-sync") !== "false";
  const outcome = await semanticEngine.exclusive(async () => {
    if (resync) {
      await semanticEngine.syncWorkspace(workspace.id);
    } else {
      await semanticEngine.ensureWorkspaceLoaded(workspace.id);
    }
    try {
      return { res: await semanticEngine.querySparql(queryText) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  if ("error" in outcome) {
    return c.json({ error: outcome.error }, 400);
  }

  return c.json({
    head: { vars: outcome.res.variables },
    results: {
      bindings: outcome.res.results.map((r) => {
        const row: Record<string, { type: string; value: string }> = {};
        for (const [k, v] of Object.entries(r)) {
          const clean = v.replace(/^<|>$/g, "");
          row[k] = {
            type: v.startsWith("<") && v.endsWith(">") ? "uri" : "literal",
            value: clean,
          };
        }
        return row;
      }),
    },
  });
});

/** Constant-time comparison, so response timing reveals nothing about the key. */
function keysMatch(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// High-Throughput IoT Telemetry Webhook Ingestion Endpoint
// Used by cellular trackers, edge gateways, AWS IoT Rules HTTPS actions, and Azure Event Grid webhooks.
app.post("/api/iot/telemetry", async (c) => {
  const reqKey = c.req.header("x-iot-api-key") || c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const expectedKey = process.env.IOT_WEBHOOK_API_KEY;
  if (!expectedKey) {
    return c.json({ error: "IoT webhook not configured: set IOT_WEBHOOK_API_KEY" }, 503);
  }

  if (!keysMatch(reqKey, expectedKey)) {
    return c.json({ error: "Unauthorized: Invalid or missing x-iot-api-key" }, 401);
  }

  try {
    const body = await c.req.json();
    const points = Array.isArray(body) ? body : [body];
    const { ingestTelemetry, webhookWorkspaceId } = await import("./services/iot/iotIngestion");

    // The key grants exactly one workspace, set by the operator. A caller asking
    // for a different one is refused outright rather than silently redirected.
    const workspaceId = await webhookWorkspaceId();
    const requested = c.req.header("x-workspace-id");
    if (requested && requested !== String(workspaceId)) {
      return c.json({ error: `This key writes to workspace ${workspaceId} only.` }, 403);
    }

    const result = await ingestTelemetry(points, { workspaceId, source: "http_webhook" });
    return c.json(result, result.success ? 200 : 207);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return c.json({ error: "Malformed JSON payload" }, 400);
    }
    // Anything else failed on our side (database, engine). Its message can name
    // internals, so it goes to the log, not to the device.
    console.error("[iot] webhook ingestion failed:", err);
    return c.json({ error: "Telemetry ingestion failed" }, 500);
  }
});

app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

// Initialize background IoT broker connectors if configured
import("./services/iot/iotBrokerManager")
  .then(({ iotBrokerManager }) => iotBrokerManager.init())
  .catch((err) => console.warn("[boot] IoT broker auto-start error:", err));

// Global Error Handler
app.onError((err, c) => {
  const reqId = c.req.header("x-request-id") || "unknown";
  console.error(`[error] Request ${reqId} failed on ${c.req.method} ${c.req.url}:`, err);
  return c.json(
    {
      error: "Internal Server Error",
      requestId: reqId,
      ...(env.isProduction ? {} : { details: err.message }),
    },
    500,
  );
});

// Process-level crash safety handlers
process.on("uncaughtException", (err) => {
  console.error("[process] Fatal Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[process] Unhandled Promise Rejection:", reason);
});

export default app;

if (env.isProduction && env.allowDemoLogin) {
  console.warn(
    "[security] ALLOW_DEMO_LOGIN is on: anyone who can reach this server can sign in as any role, " +
      "including admin, without a password. Use it for local demos only.",
  );
}

let serverHandle: { close: (cb?: () => void) => void } | undefined;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serverHandle = serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

// Graceful process lifecycle supervisor (SIGTERM / SIGINT)
const gracefulShutdown = async (signal: string) => {
  console.log(`[process] Received ${signal}. Initiating deterministic graceful teardown...`);
  try {
    const { iotBrokerManager } = await import("./services/iot/iotBrokerManager");
    await iotBrokerManager.shutdownAll();
    console.log("[process] Disconnected all active IoT broker adapters.");
  } catch (err) {
    console.error("[process] Error during IoT broker disconnect:", err);
  }

  try {
    const { closeDb } = await import("./queries/connection");
    await closeDb();
    console.log("[process] Drained and closed MySQL connection pool.");
  } catch (err) {
    console.error("[process] Error closing database connection pool:", err);
  }

  if (serverHandle) {
    serverHandle.close(() => {
      console.log("[process] HTTP server closed cleanly.");
      process.exit(0);
    });
    setTimeout(() => {
      console.error("[process] Shutdown timed out (5s). Forcing termination.");
      process.exit(1);
    }, 5000).unref();
  } else {
    process.exit(0);
  }
};

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

