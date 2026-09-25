import { afterEach, describe, expect, it, vi } from "vitest";
import { signSessionToken } from "../auth/session";
import { sessionUser } from "../auth/service";
import { createContext } from "../context";
import { findUserById } from "../queries/users";
import { appRouter } from "../router";
import { createMockContext, mockAdminUser } from "./testHarness";

vi.mock("../queries/users", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../queries/users")>()),
  findUserById: vi.fn(),
}));

const withSession = async () => {
  const token = await signSessionToken({ userId: mockAdminUser.id, email: mockAdminUser.email ?? "", role: "admin" });
  return new Headers({ cookie: `ontos_session=${token}` });
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("sessionUser", () => {
  it("answers no session for a missing token, an invalid one or an unknown user", async () => {
    await expect(sessionUser(new Headers())).resolves.toBeNull();
    await expect(sessionUser(new Headers({ cookie: "ontos_session=not-a-token" }))).resolves.toBeNull();
    vi.mocked(findUserById).mockResolvedValue(undefined);
    await expect(sessionUser(await withSession())).resolves.toBeNull();
  });

  it("does not call an unreadable database 'no session'", async () => {
    vi.mocked(findUserById).mockRejectedValue(new Error("connect ECONNREFUSED 172.19.0.3:3306"));
    await expect(sessionUser(await withSession())).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe("createContext", () => {
  const ctxFor = async (headers: Headers) =>
    createContext({ req: new Request("http://localhost/api/trpc/auth.me", { headers }), resHeaders: new Headers() } as never);

  it("marks a session it could not check, rather than dropping it", async () => {
    vi.mocked(findUserById).mockRejectedValue(new Error("connect ECONNREFUSED 172.19.0.3:3306"));
    const ctx = await ctxFor(await withSession());
    expect(ctx.user).toBeUndefined();
    expect(ctx.sessionUnavailable).toBe(true);
  });

  it("leaves a request without a session anonymous", async () => {
    const ctx = await ctxFor(new Headers());
    expect(ctx.user).toBeUndefined();
    expect(ctx.sessionUnavailable).toBeUndefined();
    expect(findUserById).not.toHaveBeenCalled();
  });
});

describe("signed-in procedures without a user", () => {
  it("answer 503 when the session could not be checked, and 401 when there is none", async () => {
    const unavailable = appRouter.createCaller({ ...createMockContext({ user: null }), sessionUnavailable: true });
    await expect(unavailable.auth.me()).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    await expect(unavailable.actions.listTypes()).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });

    const anonymous = appRouter.createCaller(createMockContext({ user: null }));
    await expect(anonymous.auth.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonymous.actions.listTypes()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
