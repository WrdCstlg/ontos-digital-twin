import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";

import { randomUUID } from "node:crypto";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";

import { sql } from "drizzle-orm";
import { getDb } from "./queries/connection";

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
    return c.json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: "connected",
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

app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

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

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
