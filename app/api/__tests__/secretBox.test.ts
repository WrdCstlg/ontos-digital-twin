import { afterEach, describe, expect, it } from "vitest";
import { env } from "../lib/env";
import {
  isCredentialField,
  isSealed,
  openSecret,
  readSecret,
  sealCredentials,
  sealSecret,
  sealedUnderCurrentKey,
  SecretUnreadableError,
  secretContext,
  secretKey,
} from "../lib/secretBox";

const saved = { secretsKey: env.secretsKey, appSecret: env.appSecret };
afterEach(() => Object.assign(env, saved));

const HERE = secretContext.connector(1, "password");
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

  it("opens only where it belongs: another workspace or field cannot open it", () => {
    const sealed = sealSecret("s3cret-pw", HERE);
    expect(reason(() => openSecret(sealed, secretContext.connector(2, "password")))).toBe("damaged");
    expect(reason(() => openSecret(sealed, secretContext.connector(1, "apiKey")))).toBe("damaged");
    expect(reason(() => openSecret(sealed, secretContext.iotConnector(1, "password")))).toBe("damaged");
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

  it("names the key it was sealed under: another key reports that, rather than a wrong password", () => {
    env.secretsKey = "a".repeat(64);
    const sealed = sealSecret("s3cret-pw", HERE);
    expect(sealedUnderCurrentKey(sealed)).toBe(true);
    env.secretsKey = "b".repeat(64);
    expect(sealedUnderCurrentKey(sealed)).toBe(false);
    expect(reason(() => openSecret(sealed, HERE))).toBe("other-key");
    env.secretsKey = "a".repeat(64);
    expect(openSecret(sealed, HERE)).toBe("s3cret-pw");
  });

  it("without SECRETS_KEY, uses a key derived from APP_SECRET, so changing APP_SECRET changes it", () => {
    env.secretsKey = undefined;
    env.appSecret = "first-app-secret-of-thirty-two-chars!";
    const sealed = sealSecret("s3cret-pw", HERE);
    expect(openSecret(sealed, HERE)).toBe("s3cret-pw");
    env.appSecret = "second-app-secret-of-thirty-two-chars";
    expect(reason(() => openSecret(sealed, HERE))).toBe("other-key");
  });

  it("takes SECRETS_KEY as 64 hex characters or base64 of 32 bytes, and refuses anything else", () => {
    const bytes = Buffer.alloc(32, 7);
    const ids = new Set<string>();
    for (const key of [bytes.toString("hex"), bytes.toString("base64"), bytes.toString("base64url")]) {
      env.secretsKey = key;
      ids.add(secretKey().id);
    }
    expect(ids.size).toBe(1);
    for (const bad of ["too-short", "a".repeat(63), Buffer.alloc(16).toString("base64"), Buffer.alloc(33).toString("hex")]) {
      env.secretsKey = bad;
      expect(() => secretKey(), bad).toThrow(/SECRETS_KEY must be 32 bytes/);
    }
  });
});

describe("reading a stored credential", () => {
  it("opens a sealed one, reads one an earlier build stored as plain text, and has none for anything else", () => {
    expect(readSecret(sealSecret("s3cret-pw", HERE), HERE)).toBe("s3cret-pw");
    expect(readSecret("legacy-plain", HERE)).toBe("legacy-plain");
    for (const none of [undefined, null, 42, { password: "x" }]) expect(readSecret(none, HERE)).toBeUndefined();
  });

  it("never hands back a sealed value it cannot open", () => {
    const sealed = sealSecret("s3cret-pw", secretContext.connector(9, "password"));
    expect(() => readSecret(sealed, HERE)).toThrow(SecretUnreadableError);
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

  it("sealCredentials seals each non-empty credential in place, and nothing else", () => {
    const config = { host: "db", user: "reader", password: "s3cret-pw", api_key: "k-1", empty: "", token: "", rows: 3 };
    const stored = sealCredentials(config, (field) => secretContext.connector(1, field));
    expect(config.password).toBe("s3cret-pw");
    expect(stored).toMatchObject({ host: "db", user: "reader", token: "", rows: 3 });
    expect(openSecret(stored.password as string, secretContext.connector(1, "password"))).toBe("s3cret-pw");
    expect(openSecret(stored.api_key as string, secretContext.connector(1, "api_key"))).toBe("k-1");
    // Sealing what is stored again changes nothing.
    expect(sealCredentials(stored, (field) => secretContext.connector(1, field))).toEqual(stored);
  });
});
