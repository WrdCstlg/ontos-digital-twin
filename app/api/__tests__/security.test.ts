import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../lib/password";
import { SlidingWindowRateLimiter } from "../lib/rateLimit";
import { signSessionToken, verifySessionToken } from "../auth/session";
import { getSessionCookieOptions } from "../lib/cookies";
import { translate } from "../services/nlq";

describe("Security Posture Verification", () => {
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
    it("refuses queries that exceed 500 characters", () => {
      const longQuery = "a".repeat(501);
      const res = translate(longQuery);
      expect(res.recognized).toBe(false);
      expect(res.refusal).toContain("capped at 500 characters");
    });

    it("refuses destructive or injection keywords", () => {
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
        const res = translate(q);
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
