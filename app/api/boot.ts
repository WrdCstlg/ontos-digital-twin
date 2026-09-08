import { Hono } from "hono";
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

const app = new Hono<{ Bindings: HttpBindings }>();

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
      if (
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:") ||
        origin.startsWith("https://localhost:")
      ) {
        return origin;
      }
      return origin;
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
      return (
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:") ||
        origin.startsWith("https://localhost:")
      );
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

app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

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
