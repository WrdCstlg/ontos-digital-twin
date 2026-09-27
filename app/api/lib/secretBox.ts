import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { env } from "./env";

/**
 * Credentials the server keeps for its own use (a SQL source's password, an
 * MQTT broker's password or client key) are sealed at rest with AES-256-GCM,
 * and opened only where the server connects. A sealed value names the key it
 * was sealed under, and is bound to where it belongs (its context: the kind of
 * connector, the workspace, the field, and the endpoint it is sent to), so a
 * value copied onto another connector, or a row whose host was changed in the
 * database, cannot be opened and sent somewhere else.
 *
 * Keys: the current one seals. It is SECRETS_KEY (32 bytes, as 64 hex
 * characters or base64) when set, and otherwise one derived from APP_SECRET.
 * Values sealed under a key the current one replaced still open: the key
 * derived from APP_SECRET once SECRETS_KEY is set, and SECRETS_KEY_PREVIOUS.
 * The bootstrap re-seals those under the current key (services/secretSealing.ts),
 * so setting or rotating the key loses nothing. A value sealed under any other
 * key cannot be opened: the server says so, and it must be entered again.
 *
 * A value an earlier build stored as plain text is still read as it is; the
 * bootstrap seals such values on every start.
 */

const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretUnreadableError extends Error {
  readonly reason: "other-key" | "damaged";
  constructor(reason: "other-key" | "damaged") {
    super(
      reason === "other-key"
        ? "it was sealed under a key this server does not have (SECRETS_KEY or APP_SECRET has changed since it was stored)"
        : "it is damaged, or was sealed for another connector or endpoint",
    );
    this.reason = reason;
    this.name = "SecretUnreadableError";
  }
}

type Key = { bytes: Buffer; id: string };
type Keyring = { current: Key; known: Map<string, Key> };

/**
 * 32 bytes, as `openssl rand -hex 32` or `openssl rand -base64 32` writes
 * them: 64 hex characters, or 44 base64 characters ending in '='. Nothing
 * looser: unpadded base64 would also take a 43-letter passphrase for a key.
 */
const KEY_FORMS: [RegExp, BufferEncoding][] = [
  [/^[0-9a-fA-F]{64}$/, "hex"],
  [/^[A-Za-z0-9+/]{43}=$/, "base64"],
];

function parseKey(raw: string, name: string): Buffer {
  for (const [form, encoding] of KEY_FORMS) if (form.test(raw)) return Buffer.from(raw, encoding);
  throw new Error(`${name} must be 32 bytes, written as 64 hex characters or as base64 (e.g. \`openssl rand -hex 32\`)`);
}

/** A key and its id: the start of its SHA-256, which each value sealed under it carries. */
const keyOf = (bytes: Buffer): Key => ({ bytes, id: createHash("sha256").update(bytes).digest("hex").slice(0, 8) });

let cached: { source: string; ring: Keyring } | null = null;

/** The key that seals, and every key this server can open with, by id. */
export function keyring(): Keyring {
  const explicit = env.secretsKey?.trim() ?? "";
  const previous = env.secretsKeyPrevious?.trim() ?? "";
  const source = [explicit, previous, env.appSecret].join("\u0000");
  if (cached?.source === source) return cached.ring;
  const derived = keyOf(Buffer.from(hkdfSync("sha256", env.appSecret, "ontos", "connector-secrets/v1", 32)));
  const current = explicit ? keyOf(parseKey(explicit, "SECRETS_KEY")) : derived;
  const known = new Map<string, Key>([[current.id, current]]);
  if (explicit) known.set(derived.id, derived);
  if (previous) {
    const old = keyOf(parseKey(previous, "SECRETS_KEY_PREVIOUS"));
    if (!known.has(old.id)) known.set(old.id, old);
  }
  cached = { source, ring: { current, known } };
  return cached.ring;
}

/** The key that seals. Calling it checks the configured keys: a malformed one throws. */
export function secretKey(): Key {
  return keyring().current;
}

const b64 = (b: Buffer) => b.toString("base64url");

export function isSealed(v: unknown): v is string {
  return typeof v === "string" && v.startsWith(PREFIX);
}

const keyIdOf = (sealed: string) => sealed.slice(PREFIX.length).split(":")[0];

/** Whether a sealed value was sealed under the current key. */
export function sealedUnderCurrentKey(sealed: string): boolean {
  return isSealed(sealed) && keyIdOf(sealed) === keyring().current.id;
}

/** Whether this server holds the key a sealed value was sealed under. */
export function sealedUnderKnownKey(sealed: string): boolean {
  return isSealed(sealed) && keyring().known.has(keyIdOf(sealed));
}

export function sealSecret(plain: string, context: string): string {
  const key = keyring().current;
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
  const key = keyring().known.get(kid);
  if (!key) throw new SecretUnreadableError("other-key");
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

/**
 * Where a sealed value belongs; opening it anywhere else fails. The endpoint
 * comes last, so the fixed-form parts before it (a numeric workspace id, a
 * credential name, which holds no ':') keep every context distinct.
 */
export const secretContext = {
  connector: (workspaceId: number, field: string, endpoint: string) => `ontos:connector:${workspaceId}:${field}:${endpoint}`,
  iotConnector: (workspaceId: number, field: string, endpoint: string) => `ontos:iot-connector:${workspaceId}:${field}:${endpoint}`,
};

/**
 * Where a connector's credentials are sent: a SQL source's driver, host, port
 * and database, or a REST connector's base URL.
 */
export function connectorEndpoint(config: Record<string, unknown>): string {
  const part = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
  if (typeof config.driver === "string") return `${config.driver}://${part(config.host)}:${part(config.port)}/${part(config.database)}`;
  return part(config.baseUrl);
}

/** Settings named like a credential, however they are spelled (api_key, apiKey, API-KEY). */
const CREDENTIAL_NAMES = new Set([
  "password", "passphrase", "secret", "clientsecret", "token", "accesstoken", "refreshtoken", "apikey", "privatekey", "clientkey",
]);

export function isCredentialField(name: string): boolean {
  return CREDENTIAL_NAMES.has(name.toLowerCase().replace(/[-_]/g, ""));
}

/**
 * Why credentials a client sent cannot be stored, or null. A credential must
 * be the credential itself, as text: never a value that looks sealed, which
 * could only have been copied from a stored row, and would otherwise be kept
 * as it is and opened for wherever the new connector points.
 */
export function credentialInputProblem(config: Record<string, unknown>): string | null {
  for (const [field, v] of Object.entries(config)) {
    if (!isCredentialField(field) || v === undefined || v === null) continue;
    if (typeof v !== "string") return `${field} must be text`;
    if (v.startsWith("enc:")) return `${field} must be the credential itself, not a sealed value`;
  }
  return null;
}

/**
 * A connector's settings, ready to store: every non-empty credential in them
 * sealed, in its place. Values already sealed are left as they are, so this
 * is only for settings whose credentials were checked (credentialInputProblem)
 * or came from the store itself.
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
