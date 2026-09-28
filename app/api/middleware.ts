import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { resolveUserWorkspace, hasWorkspaceRole } from "./services/workspaceGuard";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const isProduction = process.env.NODE_ENV === "production";
    const isInternalError = error.code === "INTERNAL_SERVER_ERROR";

    // Security event auditing: log unauthorized or forbidden access attempts
    if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
      console.warn(`[security] ${error.code}: ${error.message}`);
    } else if (isInternalError) {
      console.error("[server error]", error);
    }

    return {
      ...shape,
      data: {
        ...shape.data,
        // In production, prevent leaking internal stack traces or internal query representations
        stack: isProduction ? undefined : shape.data.stack,
      },
      message:
        isProduction && isInternalError
          ? "An unexpected internal server error occurred."
          : shape.message,
    };
  },
});

export const createRouter = t.router;
export const publicQuery = t.procedure;
export const publicProcedure = t.procedure;

/**
 * Why a signed-in procedure has no user: no session (401), or a session that
 * could not be checked (503), which the client should retry, not treat as a
 * sign-out.
 */
function noUser(ctx: TrpcContext): TRPCError {
  return ctx.sessionUnavailable
    ? new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Your session could not be checked just now. Try again in a moment." })
    : new TRPCError({ code: "UNAUTHORIZED", message: ErrorMessages.unauthenticated });
}

const requireAuth = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.user) throw noUser(ctx);

  return next({ ctx: { ...ctx, user: ctx.user } });
});

export function requireRole(role: string) {
  return t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== role) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: ErrorMessages.insufficientRole,
      });
    }

    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

export function requireAnyRole(roles: string[]) {
  return t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || !roles.includes(ctx.user.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: ErrorMessages.insufficientRole,
      });
    }

    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

export const authedProcedure = t.procedure.use(requireAuth);
export const authedQuery = authedProcedure;
export const authedMutation = authedProcedure;

export const adminProcedure = authedQuery.use(requireRole("admin"));
export const adminQuery = adminProcedure;
export const adminMutation = adminProcedure;

// Ontologists and editors (as well as admins) can mutate ontology definitions
export const ontologistProcedure = authedQuery.use(
  requireAnyRole(["admin", "ontologist", "editor"]),
);
export const ontologistQuery = ontologistProcedure;
export const ontologistMutation = ontologistProcedure;

/* ─────────────────────────────────────────────────────────────
 * Multi-tenant workspace procedures with geometric isolation
 * ───────────────────────────────────────────────────────────── */

export const requireWorkspace = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.user) throw noUser(ctx);

  if (ctx.workspace && ctx.membership) {
    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
        workspace: ctx.workspace,
        membership: ctx.membership,
      },
    });
  }

  const { workspace, membership } = await resolveUserWorkspace(
    ctx.user,
    ctx.req.headers,
  );

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      workspace,
      membership,
    },
  });
});

export function requireWorkspaceRole(allowedRoles: string[]) {
  return t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || !ctx.membership || !ctx.workspace) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: ErrorMessages.unauthenticated,
      });
    }

    if (!hasWorkspaceRole(ctx.membership, ctx.user, allowedRoles)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: ErrorMessages.insufficientRole,
      });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
        workspace: ctx.workspace,
        membership: ctx.membership,
      },
    });
  });
}

export const workspaceProcedure = authedProcedure.use(requireWorkspace);
export const workspaceQuery = workspaceProcedure;
export const workspaceMutation = workspaceProcedure;

/** The workspace roles that may change its data: editors and above. */
export const EDITOR_ROLES = ["admin", "ontologist", "editor"];

/** The workspace roles that define its ontology and the rules on its data: ontologists and admins. */
export const ONTOLOGIST_ROLES = ["admin", "ontologist"];

export const workspaceOntologistProcedure = workspaceProcedure.use(
  requireWorkspaceRole(EDITOR_ROLES),
);
export const workspaceOntologistQuery = workspaceOntologistProcedure;
export const workspaceOntologistMutation = workspaceOntologistProcedure;

export const workspaceAdminProcedure = workspaceProcedure.use(
  requireWorkspaceRole(["admin"]),
);
export const workspaceAdminQuery = workspaceAdminProcedure;
export const workspaceAdminMutation = workspaceAdminProcedure;

