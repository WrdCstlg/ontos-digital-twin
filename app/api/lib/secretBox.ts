import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { env } from "./env";

/**
 * Credentials the server keeps for its own use (a SQL source's password, an
 * MQTT broker's password or client key) are sealed at rest with AES-256-GCM,
 * and opened only where the server connects. A sealed value names the key it
 * was sealed under, and is bound to where it belongs (its context: the kind of
 * connector, the workspace and the field), so a value copied to another
 * workspace or field cannot be opened there.
 *
 * The key is SECRETS_KEY (32 bytes, as 64 hex characters or base64) when set,
 * and otherwise one derived from APP_SECRET. Values sealed under another key
 * cannot be opened: the server says so, and they must be entered again.
 *
 * A value an earlier build stored as plain text is still read as it is; the
 * bootstrap seals such values on every start (services/secretSealing.ts).
 */

const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretUnreadableError extends Error {
  readonly reason: "other-key" | "damaged";
  constructor(reason: "other-key" | "damaged") {
    super(
      reason === "other-key"
        ? "it was sealed under a different key (SECRETS_KEY or APP_SECRET has changed since it was stored)"
        : "it is damaged",
    );
    this.reason = reason;
    this.name = "SecretUnreadableError";
  }
}

type Key = { bytes: Buffer; id: string };
let cached: { source: string; key: Key } | null = null;

function parseKey(raw: string): Buffer {
  const bytes = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (bytes.length !== 32) {
    throw new Error("SECRETS_KEY must be 32 bytes, written as 64 hex characters or as base64 (e.g. `openssl rand -hex 32`)");
  }
  return bytes;
}

/** The key that seals stored credentials, and its id (the start of its SHA-256), which each sealed value carries. */
export function secretKey(): Key {
  const raw = env.secretsKey?.trim();
  const source = raw ? `explicit\u0000${raw}` : `derived\u0000${env.appSecret}`;
  if (cached?.source === source) return cached.key;
  const bytes = raw
    ? parseKey(raw)
    : Buffer.from(hkdfSync("sha256", env.appSecret, "ontos", "connector-secrets/v1", 32));
  const key = { bytes, id: createHash("sha256").update(bytes).digest("hex").slice(0, 8) };
  cached = { source, key };
  return key;
}

const b64 = (b: Buffer) => b.toString("base64url");

export function isSealed(v: unknown): v is string {
  return typeof v === "string" && v.startsWith(PREFIX);
}

/** Whether a sealed value was sealed under the current key, so this server can open it. */
export function sealedUnderCurrentKey(sealed: string): boolean {
  return isSealed(sealed) && sealed.slice(PREFIX.length).split(":")[0] === secretKey().id;
}

export function sealSecret(plain: string, context: string): string {
  const key = secretKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key.bytes, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${PREFIX}${key.id}:${b64(iv)}:${b64(ct)}:${b64(cipher.getAuthTag())}`;
}

/** Opens a sealed value, or throws SecretUnreadableError: never returns anything but the plain text. */
export function openSecret(sealed: string, context: string): string {
  const parts = isSealed(sealed) ? sealed.slice(PREFIX.length).split(":") : [];
  if (parts.length !== 4) throw new SecretUnreadableError("damaged");
  const [kid, ivText, ctText, tagText] = parts;
  const key = secretKey();
  if (kid !== key.id) throw new SecretUnreadableError("other-key");
  const iv = Buffer.from(ivText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new SecretUnreadableError("damaged");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key.bytes, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(ctText, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretUnreadableError("damaged");
  }
}

/**
 * A stored credential as the server uses it: opened if sealed, as stored if an
 * earlier build kept it as plain text, and undefined if there is none.
 */
export function readSecret(stored: unknown, context: string): string | undefined {
  if (typeof stored !== "string") return undefined;
  return isSealed(stored) ? openSecret(stored, context) : stored;
}

/** Where a sealed value belongs; opening it anywhere else fails. */
export const secretContext = {
  connector: (workspaceId: number, field: string) => `ontos:connector:${workspaceId}:${field}`,
  iotConnector: (workspaceId: number, field: string) => `ontos:iot-connector:${workspaceId}:${field}`,
};

/** Settings named like a credential, however they are spelled (api_key, apiKey, API-KEY). */
const CREDENTIAL_NAMES = new Set([
  "password", "passphrase", "secret", "clientsecret", "token", "accesstoken", "refreshtoken", "apikey", "privatekey", "clientkey",
]);

export function isCredentialField(name: string): boolean {
  return CREDENTIAL_NAMES.has(name.toLowerCase().replace(/[-_]/g, ""));
}

/**
 * A connector's settings, ready to store: every non-empty credential in them
 * sealed, in its place. Values already sealed are left as they are.
 */
export function sealCredentials(config: Record<string, unknown>, context: (field: string) => string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  for (const [field, v] of Object.entries(config)) {
    if (isCredentialField(field) && typeof v === "string" && v.length > 0 && !isSealed(v)) {
      out[field] = sealSecret(v, context(field));
    }
  }
  return out;
}
