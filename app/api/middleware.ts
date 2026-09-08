import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

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

const requireAuth = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ErrorMessages.unauthenticated,
    });
  }

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

