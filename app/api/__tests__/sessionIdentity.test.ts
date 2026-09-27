import { afterEach, describe, expect, it, vi } from "vitest";
import { signSessionToken } from "../auth/session";
import { loginDemoUser, loginWithCredentials, sessionUser } from "../auth/service";
import { env } from "../lib/env";
import { findUserByEmail, findUserById, upsertUser } from "../queries/users";
import { appRouter } from "../router";
import { createMockContext, mockAdminUser } from "./testHarness";

vi.mock("../queries/users", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../queries/users")>()),
  findUserById: vi.fn(),
  findUserByEmail: vi.fn(),
  upsertUser: vi.fn(),
}));

const PERSONA = "demo-admin@acme-ontology.com";
const OUTAGE = "connect ECONNREFUSED 172.19.0.3:3306";
const headersFor = (token: string) => new Headers({ cookie: `ontos_session=${token}` });
const tokenFor = (userId: number, email: string) => signSessionToken({ userId, email, role: "admin" });
const databaseDown = () => vi.mocked(findUserById).mockRejectedValue(new Error(OUTAGE));
const unavailable = { code: "SERVICE_UNAVAILABLE", message: "Ontos cannot sign you in just now. Try again in a moment." };

const saved = { isProduction: env.isProduction, allowDemoLogin: env.allowDemoLogin };
afterEach(() => {
  Object.assign(env, saved);
  vi.clearAllMocks();
});

describe("a session token names the account it was issued for", () => {
  it("is refused once its user id belongs to a different account, as a guessed id from an earlier build's outage sign-in does", async () => {
    vi.mocked(findUserById).mockResolvedValue(mockAdminUser); // id 1, admin@acme.com
    await expect(sessionUser(headersFor(await tokenFor(mockAdminUser.id, PERSONA)))).resolves.toBeNull();
  });

  it("is accepted for its own account, whatever the case of the address", async () => {
    vi.mocked(findUserById).mockResolvedValue(mockAdminUser);
    await expect(sessionUser(headersFor(await tokenFor(mockAdminUser.id, "Admin@ACME.com")))).resolves.toMatchObject({ id: 1 });
  });
});

describe("a persona session", () => {
  it("is refused once persona login is off in production, the database up or down, without asking it", async () => {
    Object.assign(env, { isProduction: true, allowDemoLogin: false });
    vi.mocked(findUserById).mockResolvedValue({ ...mockAdminUser, id: 7, email: PERSONA, passwordHash: null });
    await expect(sessionUser(headersFor(await tokenFor(7, PERSONA)))).resolves.toBeNull();
    databaseDown();
    await expect(sessionUser(headersFor(await tokenFor(7, PERSONA)))).resolves.toBeNull();
    expect(findUserById).not.toHaveBeenCalled();
    // While persona login is allowed, the same session holds.
    Object.assign(env, { isProduction: true, allowDemoLogin: true });
    vi.mocked(findUserById).mockResolvedValue({ ...mockAdminUser, id: 7, email: PERSONA, passwordHash: null });
    await expect(sessionUser(headersFor(await tokenFor(7, PERSONA)))).resolves.toMatchObject({ id: 7, email: PERSONA });
  });

  it("while the database is down, is otherwise one that could not be checked, like any other: no user is made up for it", async () => {
    for (const mode of [{ isProduction: true, allowDemoLogin: true }, { isProduction: false, allowDemoLogin: false }]) {
      Object.assign(env, mode);
      databaseDown();
      await expect(sessionUser(headersFor(await tokenFor(1, PERSONA)))).rejects.toThrow(/ECONNREFUSED/);
    }
  });

  it("a non-persona session counts as one that could not be checked too", async () => {
    databaseDown();
    await expect(sessionUser(headersFor(await tokenFor(mockAdminUser.id, mockAdminUser.email ?? "")))).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe("a sign-in the database cannot serve", () => {
  it("by persona answers 503 with a reason, and issues no session", async () => {
    vi.mocked(upsertUser).mockRejectedValue(new Error(OUTAGE));
    await expect(loginDemoUser("admin")).rejects.toMatchObject(unavailable);
  });

  it("by persona answers 503 as well when its account cannot be read back", async () => {
    vi.mocked(upsertUser).mockResolvedValue(undefined as never);
    vi.mocked(findUserByEmail).mockResolvedValue(undefined);
    await expect(loginDemoUser("viewer")).rejects.toMatchObject(unavailable);
  });

  it("by password answers 503, which is no verdict on the password", async () => {
    vi.mocked(findUserByEmail).mockRejectedValue(new Error(OUTAGE));
    await expect(loginWithCredentials("ada@acme.com", "a-long-password")).rejects.toMatchObject(unavailable);
  });

  it("still refuses on purpose what it would refuse anyway: a persona on the credential form, an unknown address", async () => {
    const invalid = { code: "UNAUTHORIZED", message: "Invalid email or password." };
    await expect(loginWithCredentials(PERSONA, "anything")).rejects.toMatchObject(invalid);
    vi.mocked(findUserByEmail).mockResolvedValue(undefined);
    await expect(loginWithCredentials("nobody@acme.com", "anything")).rejects.toMatchObject(invalid);
  });

  it("by password does not count toward the sign-in limit, since it reached no verdict", async () => {
    vi.mocked(findUserByEmail).mockRejectedValue(new Error(OUTAGE));
    for (let i = 0; i < 12; i++) {
      await expect(loginWithCredentials("retrying@acme.com", "a-long-password")).rejects.toMatchObject(unavailable);
    }
    // The database is back: the next attempt gets its verdict, not a lockout.
    vi.mocked(findUserByEmail).mockResolvedValue(undefined);
    await expect(loginWithCredentials("retrying@acme.com", "a-long-password")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    // Verdicts still count: ten refusals, and the eleventh attempt is limited.
    for (let i = 0; i < 9; i++) await loginWithCredentials("retrying@acme.com", "wrong").catch(() => undefined);
    await expect(loginWithCredentials("retrying@acme.com", "wrong")).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("through the router, sets no session cookie", async () => {
    vi.mocked(upsertUser).mockRejectedValue(new Error(OUTAGE));
    vi.mocked(findUserByEmail).mockRejectedValue(new Error(OUTAGE));
    const ctx = createMockContext({ user: null });
    const caller = appRouter.createCaller(ctx);
    await expect(caller.auth.demoLogin({ role: "editor" })).rejects.toMatchObject(unavailable);
    await expect(caller.auth.login({ email: "ada@acme.com", password: "a-long-password" })).rejects.toMatchObject(unavailable);
    expect(ctx.resHeaders.get("set-cookie")).toBeNull();
  });
});

describe("signing out", () => {
  it("needs no database: with the session unchecked, or none at all, it clears both session cookies", async () => {
    for (const ctx of [{ ...createMockContext({ user: null }), sessionUnavailable: true }, createMockContext({ user: null })]) {
      await expect(appRouter.createCaller(ctx).auth.logout()).resolves.toEqual({ success: true });
      const cleared = ctx.resHeaders.getSetCookie();
      expect(cleared).toHaveLength(2);
      for (const c of cleared) expect(c).toMatch(/=; .*Max-Age=0/);
    }
    expect(findUserById).not.toHaveBeenCalled();
  });
});
