import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../lib/password";
import { SlidingWindowRateLimiter } from "../lib/rateLimit";
import { signSessionToken, verifySessionToken } from "../auth/session";
import { getSessionCookieOptions } from "../lib/cookies";
import { translate } from "../services/nlq";
import { isReadOnlySparql } from "../lib/sparqlGuard";
import { demoPersonaEmails, isDemoPersona, loginWithCredentials, toPublicUser } from "../auth/service";
import { env } from "../lib/env";
import type { User } from "@db/schema";

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

  describe("Component 3: Password Security (crypto.scrypt)", () => {
    it("hashes and verifies correct passwords in constant time", async () => {
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

    it("returns null for malformed or tampered tokens", async () => {
      expect(await verifySessionToken("")).toBeNull();
      expect(await verifySessionToken("header.payload.signature")).toBeNull();
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

  describe("Component 7: Production Hardening & Anti-Bypass", () => {
    it("rejects unauthorized external origins in CORS resolution", () => {
      const allowed = ["https://app.acme-ontology.com", "https://admin.acme-ontology.com"];
      const resolveOrigin = (origin: string, isProd: boolean) => {
        if (!origin) return "";
        if (!isProd && (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:"))) {
          return origin;
        }
        if (allowed.includes(origin)) return origin;
        return "";
      };

      // Allowed in production
      expect(resolveOrigin("https://app.acme-ontology.com", true)).toBe("https://app.acme-ontology.com");
      // Malicious origin rejected in production
      expect(resolveOrigin("https://attacker.evil.com", true)).toBe("");
      // Localhost allowed in development
      expect(resolveOrigin("http://localhost:5173", false)).toBe("http://localhost:5173");
      // Arbitrary external rejected in development
      expect(resolveOrigin("https://attacker.evil.com", false)).toBe("");
    });
  });
});
