import type { User, Workspace, WorkspaceMember } from "@db/schema";
import type { TrpcContext } from "../context";
import { appRouter } from "../router";

export const mockWorkspace: Workspace = {
  id: 1,
  name: "Acme Corp — Production",
  slug: "acme-corp-production",
  plan: "enterprise",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

export const mockWorkspaceBeta: Workspace = {
  id: 2,
  name: "Beta Corp — Isolated",
  slug: "beta-corp-isolated",
  plan: "enterprise",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

export const mockAdminUser: User = {
  id: 1,
  email: "admin@acme.com",
  name: "Admin User",
  avatar: null,
  passwordHash: "mock_hash",
  role: "admin",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  lastSignInAt: new Date("2026-01-01T00:00:00Z"),
};

export const mockOntologistUser: User = {
  id: 2,
  email: "ontologist@acme.com",
  name: "Amara Okafor",
  avatar: null,
  passwordHash: "mock_hash",
  role: "ontologist",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  lastSignInAt: new Date("2026-01-01T00:00:00Z"),
};

export const mockViewerUser: User = {
  id: 3,
  email: "viewer@acme.com",
  name: "Sam Park",
  avatar: null,
  passwordHash: "mock_hash",
  role: "viewer",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  lastSignInAt: new Date("2026-01-01T00:00:00Z"),
};

export const mockAdminMembership: WorkspaceMember = {
  id: 101,
  workspaceId: 1,
  userId: 1,
  role: "admin",
  moduleScope: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

export const mockOntologistMembership: WorkspaceMember = {
  id: 102,
  workspaceId: 1,
  userId: 2,
  role: "ontologist",
  moduleScope: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

export const mockViewerMembership: WorkspaceMember = {
  id: 103,
  workspaceId: 1,
  userId: 3,
  role: "viewer",
  moduleScope: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

export function createMockContext(opts?: {
  user?: Partial<User> | null;
  workspace?: Partial<Workspace> | null;
  membership?: Partial<WorkspaceMember> | null;
  headers?: Record<string, string>;
}): TrpcContext {
  const reqHeaders = new Headers(opts?.headers ?? {});
  const user =
    opts?.user === null
      ? undefined
      : { ...mockAdminUser, ...(opts?.user ?? {}) };
  const workspace =
    opts?.workspace === null
      ? undefined
      : { ...mockWorkspace, ...(opts?.workspace ?? {}) };
  const membership =
    opts?.membership === null
      ? undefined
      : { ...mockAdminMembership, ...(opts?.membership ?? {}) };

  const req = new Request("http://localhost:3000/trpc", {
    headers: reqHeaders,
  });

  return {
    req,
    resHeaders: new Headers(),
    user,
    workspace,
    membership,
  };
}

export function createTestCaller(opts?: {
  user?: Partial<User> | null;
  workspace?: Partial<Workspace> | null;
  membership?: Partial<WorkspaceMember> | null;
  headers?: Record<string, string>;
}) {
  const ctx = createMockContext(opts);
  return appRouter.createCaller(ctx);
}
