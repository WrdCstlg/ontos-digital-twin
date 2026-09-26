import { afterEach, describe, expect, it, vi } from "vitest";
import { signSessionToken } from "../auth/session";
import { loginDemoUser, sessionUser } from "../auth/service";
import { env } from "../lib/env";
import { findUserById, upsertUser } from "../queries/users";
import { mockAdminUser } from "./testHarness";

vi.mock("../queries/users", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../queries/users")>()),
  findUserById: vi.fn(),
  upsertUser: vi.fn(),
}));

const PERSONA = "demo-admin@acme-ontology.com";
const headersFor = (token: string) => new Headers({ cookie: `ontos_session=${token}` });
const tokenFor = (userId: number, email: string) => signSessionToken({ userId, email, role: "admin" });
const databaseDown = () => vi.mocked(findUserById).mockRejectedValue(new Error("connect ECONNREFUSED 172.19.0.3:3306"));

const saved = { isProduction: env.isProduction, allowDemoLogin: env.allowDemoLogin };
afterEach(() => {
  Object.assign(env, saved);
  vi.clearAllMocks();
});

describe("a session token names the account it was issued for", () => {
  it("is refused once its user id belongs to a different account", async () => {
    vi.mocked(findUserById).mockResolvedValue(mockAdminUser); // id 1, admin@acme.com
    await expect(sessionUser(headersFor(await tokenFor(mockAdminUser.id, PERSONA)))).resolves.toBeNull();
  });

  it("is accepted for its own account, whatever the case of the address", async () => {
    vi.mocked(findUserById).mockResolvedValue(mockAdminUser);
    await expect(sessionUser(headersFor(await tokenFor(mockAdminUser.id, "Admin@ACME.com")))).resolves.toMatchObject({ id: 1 });
  });

  it("a persona sign-in made while the database was down cannot become another account's session", async () => {
    vi.mocked(upsertUser).mockRejectedValue(new Error("connect ECONNREFUSED 172.19.0.3:3306"));
    const { token } = await loginDemoUser("admin");
    // The database is back, and the id the outage sign-in guessed is the real administrator's.
    vi.mocked(findUserById).mockResolvedValue(mockAdminUser);
    await expect(sessionUser(headersFor(token))).resolves.toBeNull();
  });
});

describe("a persona session while the database is down", () => {
  it("is refused when persona login is off in production, as it is when the database is up", async () => {
    Object.assign(env, { isProduction: true, allowDemoLogin: false });
    databaseDown();
    await expect(sessionUser(headersFor(await tokenFor(1, PERSONA)))).resolves.toBeNull();
  });

  it("is kept while persona login is allowed", async () => {
    Object.assign(env, { isProduction: true, allowDemoLogin: true });
    databaseDown();
    await expect(sessionUser(headersFor(await tokenFor(1, PERSONA)))).resolves.toMatchObject({ email: PERSONA, role: "admin" });
  });

  it("a non-persona session still counts as one that could not be checked", async () => {
    databaseDown();
    await expect(sessionUser(headersFor(await tokenFor(mockAdminUser.id, mockAdminUser.email ?? "")))).rejects.toThrow(/ECONNREFUSED/);
  });
});
