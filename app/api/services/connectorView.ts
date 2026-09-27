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
 * Where a connector points, and nothing that could let someone in: an http(s)
 * URL's origin and path. A user name or password, the query string and the
 * fragment are dropped, since tokens and signatures travel there (?api_key=,
 * #access_token=, an Azure SAS ?sig=). Anything that is not an http(s) URL
 * ("svc:pw@host" parses as a scheme and a path) is cut at its first ? or #,
 * and hidden if what remains could hold a user name or password.
 */
function displayUrl(url: string): string {
  let u: URL | null = null;
  try {
    u = new URL(url);
  } catch {
    // not a URL: handled below
  }
  if (u && (u.protocol === "http:" || u.protocol === "https:")) return `${u.origin}${u.pathname}`;
  const head = url.split(/[?#]/, 1)[0];
  return head.includes("@") ? "(hidden)" : head;
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
 *
 * The row is copied column by column rather than spread: a column added to the
 * table later makes this fail to compile until someone decides whether clients
 * may see it, instead of reaching them silently (as toPublicUser does for users).
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
  if (typeof cfg.baseUrl === "string") configJson.baseUrl = displayUrl(cfg.baseUrl);
  if (typeof cfg.auth === "string" && REST_AUTH_KINDS.has(cfg.auth)) configJson.auth = cfg.auth;
  return {
    id: c.id,
    workspaceId: c.workspaceId,
    name: c.name,
    type: c.type,
    status: c.status,
    createdAt: c.createdAt,
    configJson,
  };
}
