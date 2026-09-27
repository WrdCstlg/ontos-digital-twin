import type { Connector } from "@db/schema";

/**
 * The settings a client may see, by name. Anything else a connector's
 * configJson holds (a password, an inline CSV payload, a token some later
 * connector type adds) stays on the server: this is an allowlist, so a new
 * secret is hidden until someone decides to show it.
 */
const SHOWN = ["filename", "rows", "schedule", "mode", "driver", "host", "port", "database", "user", "ssl", "schema"] as const;

/** A REST connector's auth is shown as its kind, never as a credential. */
const REST_AUTH_KINDS = new Set(["oauth2-client-credentials", "bearer", "api-key", "none"]);

function isPlain(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/**
 * A URL without any user name or password written into it. Only an http(s)
 * URL is parsed for them: anything else ("svc:pw@host" parses as a scheme and
 * a path) is shown only if nothing in it could be userinfo.
 */
function withoutUserinfo(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url.includes("@") ? "(hidden)" : url;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return url.includes("@") ? "(hidden)" : url;
  if (!u.username && !u.password) return url;
  u.username = "";
  u.password = "";
  return u.toString();
}

/** A connector's settings as clients see them. */
export type PublicConnectorConfig = Partial<Record<(typeof SHOWN)[number] | "baseUrl" | "auth", string | number | boolean>> & {
  /** The connector holds its data inline (a CSV upload), which is never sent. */
  hasInlineData: boolean;
  /** The connector holds a password, which is never sent. */
  hasPassword: boolean;
};

export type PublicConnector = Omit<Connector, "configJson"> & { configJson: PublicConnectorConfig };

/**
 * A connector as clients see it. Every connector that leaves the server passes
 * through here, whoever asks: its stored password and inline data are used by
 * the server alone, and every workspace member can list connectors.
 */
export function publicConnector(c: Connector): PublicConnector {
  const cfg = (c.configJson ?? {}) as Record<string, unknown>;
  const configJson: PublicConnectorConfig = {
    hasInlineData: typeof cfg.csvText === "string",
    hasPassword: typeof cfg.password === "string" && cfg.password.length > 0,
  };
  for (const key of SHOWN) {
    const v = cfg[key];
    if (isPlain(v)) configJson[key] = v;
  }
  if (typeof cfg.baseUrl === "string") configJson.baseUrl = withoutUserinfo(cfg.baseUrl);
  if (typeof cfg.auth === "string" && REST_AUTH_KINDS.has(cfg.auth)) configJson.auth = cfg.auth;
  return { ...c, configJson };
}
