import { afterEach, beforeAll, beforeEach, describe, it, expect, vi } from "vitest";
import * as jose from "jose";
import { hashPassword, verifyPassword } from "../lib/password";
import { SlidingWindowRateLimiter, authRateLimiter } from "../lib/rateLimit";
import { signSessionToken, verifySessionToken } from "../auth/session";
import { getSessionCookieOptions } from "../lib/cookies";
import { translate } from "../services/nlq";
import { isReadOnlySparql } from "../lib/sparqlGuard";
import { demoPersonaEmails, isDemoPersona, loginWithCredentials, toPublicUser } from "../auth/service";
import { env } from "../lib/env";
import type { User } from "@db/schema";

// Stand-in database for loginWithCredentials. The real findUserByEmail runs
// against it: every `select().from().where().limit()` resolves to `userRows`,
// and `update().set().where()` (lastSignInAt stamp) resolves to nothing.
const dbState = vi.hoisted(() => ({
  userRows: [] as unknown[],
  selects: 0,
}));

vi.mock("../queries/connection", () => ({
  getDb: () => ({
    select: () => {
      dbState.selects += 1;
      return {
        from: () => ({
          where: () => ({ limit: () => Promise.resolve(dbState.userRows) }),
        }),
      };
    },
    update: () => ({
      set: () => ({ where: () => Promise.resolve() }),
    }),
  }),
}));

describe("Security Posture Verification", () => {
  describe("SPARQL endpoint read-only gate", () => {
    it("accepts the four SPARQL 1.1 query forms", () => {
      expect(isReadOnlySparql("SELECT ?s WHERE { ?s ?p ?o }")).toBe(true);
      expect(isReadOnlySparql("ASK { ?s ?p ?o }")).toBe(true);
      expect(isReadOnlySparql("CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }")).toBe(true);
      expect(isReadOnlySparql("DESCRIBE <https://ontos.dev/x>")).toBe(true);
      expect(isReadOnlySparql("  select ?s where { ?s ?p ?o }")).toBe(true);
    });

    it("accepts a query behind a PREFIX/BASE prologue", () => {
      const q = `BASE <https://ontos.dev/>
        PREFIX hr: <https://ontos.dev/ontology/hr/>
        SELECT ?p WHERE { ?p a hr:Person }`;
      expect(isReadOnlySparql(q)).toBe(true);
    });

    it("rejects every SPARQL update form", () => {
      expect(isReadOnlySparql("INSERT DATA { <a> <b> <c> }")).toBe(false);
      expect(isReadOnlySparql("DELETE WHERE { ?s ?p ?o }")).toBe(false);
      expect(isReadOnlySparql("DROP GRAPH <https://ontos.dev/g>")).toBe(false);
      expect(isReadOnlySparql("CLEAR ALL")).toBe(false);
      expect(isReadOnlySparql("LOAD <https://evil.example/data.ttl>")).toBe(false);
      expect(isReadOnlySparql("CREATE GRAPH <https://ontos.dev/g>")).toBe(false);
      expect(isReadOnlySparql("COPY DEFAULT TO <https://ontos.dev/g>")).toBe(false);
    });

    it("rejects an update smuggled in after a valid query form", () => {
      expect(
        isReadOnlySparql("SELECT ?s WHERE { ?s ?p ?o } ; INSERT DATA { <a> <b> <c> }"),
      ).toBe(false);
    });

    it("rejects an update hidden behind a comment-only first line", () => {
      expect(isReadOnlySparql("# SELECT ?s\nDELETE WHERE { ?s ?p ?o }")).toBe(false);
    });

    it("does not mistake a '#' inside an IRI for a comment", () => {
      const q = "SELECT ?s WHERE { ?s a <http://example.org/schema#Person> }";
      expect(isReadOnlySparql(q)).toBe(true);
    });

    it("does not treat update keywords inside IRIs or literals as updates", () => {
      expect(
        isReadOnlySparql('SELECT ?s WHERE { ?s <https://ontos.dev/insert> "drop all" }'),
      ).toBe(true);
    });

    it("does not treat variables or prefixed names as update keywords", () => {
      expect(isReadOnlySparql("SELECT ?delete WHERE { ?delete ?p ?o }")).toBe(true);
      expect(isReadOnlySparql("SELECT ?s WHERE { ?s a ex:insert }")).toBe(true);
    });

    it("rejects empty and non-query input", () => {
      expect(isReadOnlySparql("")).toBe(false);
      expect(isReadOnlySparql("   ")).toBe(false);
      expect(isReadOnlySparql("not a query at all")).toBe(false);
    });
  });

  describe("Client-safe user projection", () => {
    const user: User = {
      id: 1,
      email: "admin@acme-ontology.com",
      name: "Elena Cortez",
      avatar: null,
      passwordHash: "deadbeef:cafebabe",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignInAt: new Date(),
    };

    it("never emits the password hash", () => {
      const projected = toPublicUser(user);
      expect("passwordHash" in projected).toBe(false);
      expect(JSON.stringify(projected)).not.toContain("deadbeef");
    });

    it("preserves the fields the client actually renders", () => {
      const projected = toPublicUser(user);
      expect(projected.id).toBe(1);
      expect(projected.email).toBe("admin@acme-ontology.com");
      expect(projected.name).toBe("Elena Cortez");
      expect(projected.role).toBe("admin");
      expect(projected.lastSignInAt).toEqual(user.lastSignInAt);
    });
  });

  describe("Demo personas", () => {
    it("recognises current and legacy persona addresses, case-insensitively", () => {
      expect(isDemoPersona("demo-admin@acme-ontology.com")).toBe(true);
      expect(isDemoPersona("DEMO-Viewer@Acme-Ontology.com")).toBe(true);
      expect(isDemoPersona("ontologist@acme-ontology.com")).toBe(true);
      expect(isDemoPersona("someone@example.com")).toBe(false);
      expect(isDemoPersona(null)).toBe(false);
    });

    it("never treats the configured admin address as a persona", () => {
      const admin = env.adminEmail.trim().toLowerCase();
      expect(demoPersonaEmails()).not.toContain(admin);
      expect(isDemoPersona(admin)).toBe(false);
    });

    it("refuses persona addresses on the credential form, even with the old public password", async () => {
      await expect(
        loginWithCredentials("demo-admin@acme-ontology.com", "ontos2026!"),
      ).rejects.toThrow("Invalid email or password.");
    });
  });

  describe("Login lockout (loginWithCredentials + authRateLimiter)", () => {
    // authRateLimiter: 10 attempts per 15 minutes per normalised email.
    const EMAIL = "lockout.target@example.com";
    const OTHER_EMAIL = "bystander@example.com";
    const PASSWORD = "Correct-Horse-Battery-2026!";
    const WRONG = "not-the-password";
    let account: User;

    beforeAll(async () => {
      account = {
        id: 77,
        email: EMAIL,
        name: "Lockout Target",
        avatar: null,
        passwordHash: await hashPassword(PASSWORD),
        role: "editor",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignInAt: new Date(),
      };
    });

    beforeEach(() => {
      dbState.userRows = [account];
      dbState.selects = 0;
      authRateLimiter.reset(EMAIL);
      authRateLimiter.reset(OTHER_EMAIL);
    });

    afterEach(() => {
      dbState.userRows = [];
      authRateLimiter.reset(EMAIL);
      authRateLimiter.reset(OTHER_EMAIL);
    });

    async function failOnce(email: string) {
      await expect(loginWithCredentials(email, WRONG)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    }

    it("control: the correct password signs in and yields a verifiable session token", async () => {
      const { user, token } = await loginWithCredentials(EMAIL, PASSWORD);
      expect(user.id).toBe(account.id);
      const claims = await verifySessionToken(token);
      expect(claims).toMatchObject({ userId: account.id, email: EMAIL, role: "editor" });
    });

    it("refuses the 11th attempt with TOO_MANY_REQUESTS even when the password is correct", async () => {
      for (let i = 0; i < 10; i++) await failOnce(EMAIL);

      const lookupsBefore = dbState.selects;
      await expect(loginWithCredentials(EMAIL, PASSWORD)).rejects.toMatchObject({
        code: "TOO_MANY_REQUESTS",
      });
      // Refused before the user lookup: no credential work while locked out.
      expect(dbState.selects).toBe(lookupsBefore);
    });

    it("keys the budget on the normalised email, so case and whitespace variants share one budget", async () => {
      const variants = [
        EMAIL.toUpperCase(),
        `  ${EMAIL}  `,
        "Lockout.Target@Example.COM",
        `\t${EMAIL}\n`,
        " LOCKOUT.target@example.com",
      ];
      // No single spelling reaches 10 attempts on its own (2 each).
      for (let i = 0; i < 10; i++) await failOnce(variants[i % variants.length]);

      await expect(loginWithCredentials(EMAIL, PASSWORD)).rejects.toMatchObject({
        code: "TOO_MANY_REQUESTS",
      });
      await expect(loginWithCredentials(`  ${EMAIL.toUpperCase()} `, PASSWORD)).rejects.toMatchObject({
        code: "TOO_MANY_REQUESTS",
      });

      // A different account keeps its own budget.
      dbState.userRows = [];
      await failOnce(OTHER_EMAIL);
    });

    it("resets the budget on a successful login", async () => {
      for (let i = 0; i < 9; i++) await failOnce(EMAIL);

      // 10th attempt in the window: succeeds and clears the budget.
      const first = await loginWithCredentials(EMAIL, PASSWORD);
      expect(first.user.id).toBe(account.id);

      // Without the reset this would be the 11th attempt in the window and be refused.
      const second = await loginWithCredentials(EMAIL, PASSWORD);
      expect((await verifySessionToken(second.token))?.userId).toBe(account.id);
    });
  });

  describe("Component 3: Password Security (crypto.scrypt)", () => {
    it("hashes to a 16-byte-salt:64-byte-key hex pair and verifies only the matching password", async () => {
      const password = "SuperSecretPassword2026!";
      const hash = await hashPassword(password);

      expect(hash).toContain(":");
      const [salt, key] = hash.split(":");
      expect(salt).toHaveLength(32); // 16 bytes hex
      expect(key).toHaveLength(128); // 64 bytes hex

      const isValid = await verifyPassword(password, hash);
      expect(isValid).toBe(true);

      const isInvalid = await verifyPassword("WrongPassword123!", hash);
      expect(isInvalid).toBe(false);
    });

    it("safely rejects malformed or truncated hash strings without throwing", async () => {
      expect(await verifyPassword("test", "")).toBe(false);
      expect(await verifyPassword("test", "corrupted-no-colon")).toBe(false);
      expect(await verifyPassword("test", "salt:")).toBe(false);
      expect(await verifyPassword("test", ":key")).toBe(false);
    });
  });

  describe("Component 5: Sliding Window Rate Limiter", () => {
    it("allows requests up to max and blocks thereafter with resetMs calculation", () => {
      const limiter = new SlidingWindowRateLimiter({ windowMs: 1000, max: 3 });

      expect(limiter.check("client-1").allowed).toBe(true);
      expect(limiter.check("client-1").allowed).toBe(true);
      expect(limiter.check("client-1").allowed).toBe(true);

      const blocked = limiter.check("client-1");
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
      expect(blocked.resetMs).toBeGreaterThan(0);

      // Separate client is not blocked
      expect(limiter.check("client-2").allowed).toBe(true);

      // Reset clears hits
      limiter.reset("client-1");
      expect(limiter.check("client-1").allowed).toBe(true);
    });
  });

  describe("Component 3: JWT Session Hardening", () => {
    it("signs and verifies tokens with issuer and claims", async () => {
      const token = await signSessionToken({
        userId: 42,
        email: "security@acme-ontology.com",
        role: "ontologist",
      });

      expect(typeof token).toBe("string");
      const claims = await verifySessionToken(token);
      expect(claims).not.toBeNull();
      expect(claims?.userId).toBe(42);
      expect(claims?.email).toBe("security@acme-ontology.com");
      expect(claims?.role).toBe("ontologist");
    });

    it("returns null for empty and structurally malformed tokens", async () => {
      expect(await verifySessionToken("")).toBeNull();
      expect(await verifySessionToken("header.payload.signature")).toBeNull();
    });

    describe("tamper resistance", () => {
      const claims = { userId: 42, email: "security@acme-ontology.com", role: "viewer" };
      const ISSUER = "ontos-platform";
      const DAY_MS = 24 * 60 * 60 * 1000;
      const realSecret = () => new TextEncoder().encode(env.appSecret);
      const split = (token: string) => token.split(".") as [string, string, string];
      const encodeSegment = (obj: unknown) =>
        Buffer.from(JSON.stringify(obj)).toString("base64url");

      it("control: an untouched token verifies", async () => {
        const token = await signSessionToken(claims);
        expect(await verifySessionToken(token)).toEqual(claims);
      });

      it("rejects a token whose signature was altered or stripped", async () => {
        const [header, payload, signature] = split(await signSessionToken(claims));
        // Change the first signature character: it carries 6 real bits, unlike
        // the last one, whose low bits are base64url padding.
        const altered = (signature[0] === "A" ? "B" : "A") + signature.slice(1);

        expect(await verifySessionToken(`${header}.${payload}.${altered}`)).toBeNull();
        expect(await verifySessionToken(`${header}.${payload}.`)).toBeNull();
      });

      it("rejects a token whose payload was swapped for escalated claims under the original signature", async () => {
        const [header, payload, signature] = split(await signSessionToken(claims));
        const original = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        const escalated = encodeSegment({ ...original, userId: 1, role: "admin" });

        expect(await verifySessionToken(`${header}.${escalated}.${signature}`)).toBeNull();
      });

      it("rejects a token signed with a different secret", async () => {
        const forged = await new jose.SignJWT(claims)
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt()
          .setExpirationTime("7d")
          .setIssuer(ISSUER)
          .sign(new TextEncoder().encode("attacker-chosen-secret-of-reasonable-length"));

        expect(await verifySessionToken(forged)).toBeNull();
      });

      it("rejects an unsigned alg:none token and a token signed with another HMAC algorithm", async () => {
        const unsigned = new jose.UnsecuredJWT(claims)
          .setIssuedAt()
          .setExpirationTime("7d")
          .setIssuer(ISSUER)
          .encode();
        const hs512 = await new jose.SignJWT(claims)
          .setProtectedHeader({ alg: "HS512" })
          .setIssuedAt()
          .setExpirationTime("7d")
          .setIssuer(ISSUER)
          .sign(realSecret());

        expect(await verifySessionToken(unsigned)).toBeNull();
        expect(await verifySessionToken(hs512)).toBeNull();
      });

      it("rejects a correctly signed token from another issuer, or with no issuer", async () => {
        const foreign = await new jose.SignJWT(claims)
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt()
          .setExpirationTime("7d")
          .setIssuer("some-other-service")
          .sign(realSecret());
        const noIssuer = await new jose.SignJWT(claims)
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt()
          .setExpirationTime("7d")
          .sign(realSecret());

        expect(await verifySessionToken(foreign)).toBeNull();
        expect(await verifySessionToken(noIssuer)).toBeNull();
      });

      it("rejects a correctly signed token that lacks the identity claims", async () => {
        const noUserId = await new jose.SignJWT({ email: claims.email, role: claims.role })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt()
          .setExpirationTime("7d")
          .setIssuer(ISSUER)
          .sign(realSecret());

        expect(await verifySessionToken(noUserId)).toBeNull();
      });

      it("honours the 7-day lifetime: valid after 6 days, rejected once 7 have passed", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
          const issuedAt = new Date("2026-03-01T09:00:00Z").getTime();
          vi.setSystemTime(issuedAt);
          const token = await signSessionToken(claims);

          vi.setSystemTime(issuedAt + 6 * DAY_MS);
          expect(await verifySessionToken(token)).toEqual(claims);

          vi.setSystemTime(issuedAt + 7 * DAY_MS + 1000);
          expect(await verifySessionToken(token)).toBeNull();
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });

  describe("Component 4: Cookie Hardening", () => {
    it("provides __Host- prefix in production on non-localhost and enforces Strict", () => {
      const headers = new Headers();
      headers.set("host", "app.acme-ontology.com");

      const opts = getSessionCookieOptions(headers);
      expect(opts.httpOnly).toBe(true);
      expect(opts.sameSite).toBe("Strict");
      expect(opts.secure).toBe(true);
      expect(opts.partitioned).toBe(true);
    });

    it("allows non-secure cookie on localhost for development ergonomics", () => {
      const devHeaders = new Headers();
      devHeaders.set("host", "localhost:3000");

      const devOpts = getSessionCookieOptions(devHeaders);
      expect(devOpts.httpOnly).toBe(true);
      expect(devOpts.sameSite).toBe("Strict");
      expect(devOpts.secure).toBe(false);
    });
  });

  describe("Component 6: Input Validation & NLQ Sanitization", () => {
    it("refuses queries that exceed 500 characters", async () => {
      const longQuery = "a".repeat(501);
      const res = await translate(longQuery);
      expect(res.recognized).toBe(false);
      expect(res.refusal).toContain("capped at 500 characters");
    });

    it("refuses destructive or injection keywords", async () => {
      const destructive = [
        "DROP TABLE users",
        "DELETE FROM kg_nodes",
        "TRUNCATE workspaces",
        "show me passwords",
        "UNION ALL SELECT * FROM users",
        "<script>alert(1)</script>",
        "EXEC xp_cmdshell",
      ];

      for (const q of destructive) {
        const res = await translate(q);
        expect(res.recognized).toBe(false);
        expect(res.refusal).toBeDefined();
      }
    });
  });
});
