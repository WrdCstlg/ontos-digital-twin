import { afterEach, describe, expect, it, vi } from "vitest";

// env.ts reads the environment once, on import: each case imports it afresh.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("APP_SECRET", () => {
  it("in production must be at least 32 characters: it signs sessions, and derives the credential key when SECRETS_KEY is unset", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "mysql://ontos@db:3306/ontos");
    vi.stubEnv("APP_SECRET", "x".repeat(31));
    await expect(import("../lib/env")).rejects.toThrow(/APP_SECRET must be at least 32 characters/);
    vi.resetModules();
    vi.stubEnv("APP_SECRET", "x".repeat(32));
    await expect(import("../lib/env")).resolves.toMatchObject({ env: { appSecret: "x".repeat(32), isProduction: true } });
  });

  it("outside production may be short, for development", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("APP_SECRET", "short");
    await expect(import("../lib/env")).resolves.toMatchObject({ env: { appSecret: "short" } });
  });
});
