import { afterEach, describe, expect, it } from "vitest";
import { env } from "../lib/env";
import {
  connectorEndpoint,
  credentialInputProblem,
  isCredentialField,
  isSealed,
  openSecret,
  readSecret,
  sealCredentials,
  sealSecret,
  sealedUnderCurrentKey,
  sealedUnderKnownKey,
  SecretUnreadableError,
  secretContext,
  secretKey,
} from "../lib/secretBox";

const saved = { secretsKey: env.secretsKey, secretsKeyPrevious: env.secretsKeyPrevious, appSecret: env.appSecret };
afterEach(() => Object.assign(env, saved));

const ENDPOINT = "mysql://db.acme.corp:3306/hr";
const HERE = secretContext.connector(1, "password", ENDPOINT);
const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const reason = (f: () => unknown) => {
  try {
    f();
  } catch (err) {
    return err instanceof SecretUnreadableError ? err.reason : `not unreadable: ${String(err)}`;
  }
  return "opened";
};

describe("sealing a credential", () => {
  it("opens to what was sealed, and never shows it", () => {
    const sealed = sealSecret("s3cret-pw", HERE);
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain("s3cret");
    expect(openSecret(sealed, HERE)).toBe("s3cret-pw");
    expect(openSecret(sealSecret("", HERE), HERE)).toBe("");
    expect(openSecret(sealSecret("pässwörd ✓", HERE), HERE)).toBe("pässwörd ✓");
  });

  it("seals the same credential differently each time", () => {
    expect(sealSecret("s3cret-pw", HERE)).not.toBe(sealSecret("s3cret-pw", HERE));
  });

  it("opens only where it belongs: another workspace, field, kind of connector or endpoint cannot open it", () => {
    const sealed = sealSecret("s3cret-pw", HERE);
    for (const elsewhere of [
      secretContext.connector(2, "password", ENDPOINT),
      secretContext.connector(1, "apiKey", ENDPOINT),
      secretContext.iotConnector(1, "password", ENDPOINT),
      secretContext.connector(1, "password", "mysql://attacker.example:3306/hr"),
      secretContext.connector(1, "password", "mysql://db.acme.corp:3307/hr"),
    ]) {
      expect(reason(() => openSecret(sealed, elsewhere)), elsewhere).toBe("damaged");
    }
  });

  it("refuses a sealed value that was altered, cut short, or is not one", () => {
    const sealed = sealSecret("s3cret-pw", HERE);
    const [prefix, version, kid, iv, ct, tag] = sealed.split(":");
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
    for (const bad of [
      [prefix, version, kid, iv, flip(ct), tag],
      [prefix, version, kid, flip(iv), ct, tag],
      [prefix, version, kid, iv, ct, flip(tag)],
      // A shortened tag is refused, not checked on fewer bits.
      [prefix, version, kid, iv, ct, Buffer.from(tag, "base64url").subarray(0, 4).toString("base64url")],
      [prefix, version, kid, iv, ct],
    ]) {
      expect(reason(() => openSecret(bad.join(":"), HERE)), bad.join(":")).toBe("damaged");
    }
    expect(reason(() => openSecret("s3cret-pw", HERE))).toBe("damaged");
  });
});

describe("the keys", () => {
  it("name the key a value was sealed under: a key this server does not hold reports that, rather than a wrong password", () => {
    env.secretsKey = KEY_A;
    const sealed = sealSecret("s3cret-pw", HERE);
    expect(sealedUnderCurrentKey(sealed)).toBe(true);
    env.secretsKey = KEY_B;
    expect(sealedUnderKnownKey(sealed)).toBe(false);
    expect(reason(() => openSecret(sealed, HERE))).toBe("other-key");
    env.secretsKey = KEY_A;
    expect(openSecret(sealed, HERE)).toBe("s3cret-pw");
  });

  it("without SECRETS_KEY, use one derived from APP_SECRET, so changing APP_SECRET alone loses what it sealed", () => {
    env.secretsKey = undefined;
    env.appSecret = "first-app-secret-of-thirty-two-chars!";
    const sealed = sealSecret("s3cret-pw", HERE);
    expect(openSecret(sealed, HERE)).toBe("s3cret-pw");
    env.appSecret = "second-app-secret-of-thirty-two-chars";
    expect(reason(() => openSecret(sealed, HERE))).toBe("other-key");
  });

  it("setting SECRETS_KEY later loses nothing: what the derived key sealed still opens, to be sealed again", () => {
    env.secretsKey = undefined;
    const underDerived = sealSecret("s3cret-pw", HERE);
    env.secretsKey = KEY_A;
    expect(sealedUnderCurrentKey(underDerived)).toBe(false);
    expect(sealedUnderKnownKey(underDerived)).toBe(true);
    expect(openSecret(underDerived, HERE)).toBe("s3cret-pw");
    expect(sealedUnderCurrentKey(sealSecret("s3cret-pw", HERE))).toBe(true);
  });

  it("rotating SECRETS_KEY loses nothing while SECRETS_KEY_PREVIOUS names the old one", () => {
    env.secretsKey = KEY_A;
    const underA = sealSecret("s3cret-pw", HERE);
    env.secretsKey = KEY_B;
    expect(reason(() => openSecret(underA, HERE))).toBe("other-key");
    env.secretsKeyPrevious = KEY_A;
    expect(openSecret(underA, HERE)).toBe("s3cret-pw");
    expect(sealedUnderCurrentKey(underA)).toBe(false);
    expect(sealedUnderCurrentKey(sealSecret("s3cret-pw", HERE))).toBe(true);
  });

  it("take SECRETS_KEY as 64 hex characters or padded base64 of 32 bytes, and refuse anything looser", () => {
    const bytes = Buffer.alloc(32, 7);
    const ids = new Set<string>();
    for (const key of [bytes.toString("hex"), bytes.toString("hex").toUpperCase(), bytes.toString("base64")]) {
      env.secretsKey = key;
      ids.add(secretKey().id);
    }
    expect(ids.size).toBe(1);
    for (const bad of [
      "too-short",
      "a".repeat(63),
      Buffer.alloc(16).toString("base64"),
      Buffer.alloc(33).toString("hex"),
      bytes.toString("base64url"), // unpadded: a 43-letter passphrase would pass as one
      "ThisIsMyVerySecretKeyForOntosProduction2026",
      "correct horse battery staple ontos production key!!!!!!!!",
    ]) {
      env.secretsKey = bad;
      expect(() => secretKey(), bad).toThrow(/SECRETS_KEY must be 32 bytes/);
    }
    env.secretsKey = KEY_A;
    env.secretsKeyPrevious = "not a key";
    expect(() => secretKey()).toThrow(/SECRETS_KEY_PREVIOUS must be 32 bytes/);
  });
});

describe("reading a stored credential", () => {
  it("opens a sealed one, reads one an earlier build stored as plain text, and has none for anything else", () => {
    expect(readSecret(sealSecret("s3cret-pw", HERE), HERE)).toBe("s3cret-pw");
    expect(readSecret("legacy-plain", HERE)).toBe("legacy-plain");
    for (const none of [undefined, null, 42, { password: "x" }]) expect(readSecret(none, HERE)).toBeUndefined();
  });

  it("never hands back a sealed value it cannot open", () => {
    const sealed = sealSecret("s3cret-pw", secretContext.connector(9, "password", ENDPOINT));
    expect(() => readSecret(sealed, HERE)).toThrow(SecretUnreadableError);
  });
});

describe("where a connector's credentials go", () => {
  it("is a SQL source's driver, host, port and database, or a REST connector's base URL", () => {
    expect(connectorEndpoint({ driver: "mysql", host: "db.acme.corp", port: 3306, database: "hr", user: "reader" })).toBe(ENDPOINT);
    expect(connectorEndpoint({ driver: "postgresql", host: "pg", database: "d" })).toBe("postgresql://pg:/d");
    expect(connectorEndpoint({ baseUrl: "https://erp.acme.corp/api" })).toBe("https://erp.acme.corp/api");
    expect(connectorEndpoint({ filename: "hris.csv" })).toBe("");
  });
});

describe("which settings are credentials", () => {
  it("knows them however they are spelled", () => {
    for (const name of ["password", "Password", "api_key", "apiKey", "API-KEY", "clientKey", "client_secret", "token", "accessToken", "privateKey", "passphrase"]) {
      expect(isCredentialField(name), name).toBe(true);
    }
    for (const name of ["user", "username", "host", "caCert", "clientCert", "passwordHint", "tokenUrl", "auth"]) {
      expect(isCredentialField(name), name).toBe(false);
    }
  });

  it("takes from a client only the credential itself, as text: never a sealed value copied from a stored row", () => {
    expect(credentialInputProblem({ host: "db", password: "s3cret-pw", apiKey: undefined, token: null })).toBeNull();
    expect(credentialInputProblem({ password: sealSecret("s3cret-pw", HERE) })).toMatch(/password must be the credential itself/);
    expect(credentialInputProblem({ api_key: "enc:v2:anything" })).toMatch(/api_key must be the credential itself/);
    expect(credentialInputProblem({ password: 12345678 })).toMatch(/password must be text/);
    // Settings that are not credentials are not its business.
    expect(credentialInputProblem({ host: "enc:host", rows: 3 })).toBeNull();
  });

  it("sealCredentials seals each non-empty credential in place, and nothing else", () => {
    const config = { host: "db", user: "reader", password: "s3cret-pw", api_key: "k-1", empty: "", token: "", rows: 3 };
    const stored = sealCredentials(config, (field) => secretContext.connector(1, field, ENDPOINT));
    expect(config.password).toBe("s3cret-pw");
    expect(stored).toMatchObject({ host: "db", user: "reader", token: "", rows: 3 });
    expect(openSecret(stored.password as string, secretContext.connector(1, "password", ENDPOINT))).toBe("s3cret-pw");
    expect(openSecret(stored.api_key as string, secretContext.connector(1, "api_key", ENDPOINT))).toBe("k-1");
    // Sealing what is stored again changes nothing.
    expect(sealCredentials(stored, (field) => secretContext.connector(1, field, ENDPOINT))).toEqual(stored);
  });
});
