import type { CookieOptions } from "hono/utils/cookie";
import { Session } from "@contracts/constants";
import { env } from "./env";

export function isLocalhost(headers?: Headers): boolean {
  if (!headers) return false;
  const host = headers.get("host") || "";
  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:");
}

/**
 * Dual-name cookie strategy:
 * Uses '__Host-ontos_session' in production (HTTPS-only, root path, no domain)
 * Uses 'ontos_session' in local development or when testing without TLS.
 */
export function getSessionCookieName(headers?: Headers): string {
  if (env.isProduction && !isLocalhost(headers)) {
    return Session.prodCookieName;
  }
  return Session.cookieName;
}

export function getSessionCookieOptions(headers: Headers): CookieOptions {
  const localhost = isLocalhost(headers);

  return {
    httpOnly: true,
    path: "/",
    sameSite: "Strict",
    secure: !localhost,
    partitioned: true,
  };
}

