import * as cookie from "cookie";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Session } from "@contracts/constants";
import { getSessionCookieName, getSessionCookieOptions } from "./lib/cookies";
import { env } from "./lib/env";
import { createRouter, authedQuery, publicQuery } from "./middleware";
import { loginDemoUser, loginWithCredentials, toPublicUser } from "./auth/service";

export const authRouter = createRouter({
  me: authedQuery.query((opts) => toPublicUser(opts.ctx.user)),

  /** One-click demo login — instantly creates a session for the chosen persona (development only) */
  demoLogin: publicQuery
    .input(
      z.object({
        role: z.enum(["admin", "ontologist", "editor", "viewer"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (env.isProduction && !env.allowDemoLogin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Demo login is disabled in production. Sign in with credentials, or set ALLOW_DEMO_LOGIN=true for a local demo.",
        });
      }
      const { user, token } = await loginDemoUser(input.role);
      const cookieName = getSessionCookieName(ctx.req.headers);
      const opts = getSessionCookieOptions(ctx.req.headers);
      ctx.resHeaders.append(
        "set-cookie",
        cookie.serialize(cookieName, token, {
          httpOnly: opts.httpOnly,
          path: opts.path,
          sameSite: (opts.sameSite?.toLowerCase() ?? "strict") as "strict" | "lax" | "none",
          secure: opts.secure,
          maxAge: Session.maxAgeMs / 1000,
        }),
      );
      return toPublicUser(user);
    }),

  /** Enterprise credentials login */
  login: publicQuery
    .input(
      z.object({
        email: z
          .string()
          .email()
          .max(320)
          .transform((v) => v.trim().toLowerCase()),
        password: z.string().min(1).max(128),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { user, token } = await loginWithCredentials(
        input.email,
        input.password,
      );
      const cookieName = getSessionCookieName(ctx.req.headers);
      const opts = getSessionCookieOptions(ctx.req.headers);
      ctx.resHeaders.append(
        "set-cookie",
        cookie.serialize(cookieName, token, {
          httpOnly: opts.httpOnly,
          path: opts.path,
          sameSite: (opts.sameSite?.toLowerCase() ?? "strict") as "strict" | "lax" | "none",
          secure: opts.secure,
          maxAge: Session.maxAgeMs / 1000,
        }),
      );
      return toPublicUser(user);
    }),

  logout: authedQuery.mutation(async ({ ctx }) => {
    const opts = getSessionCookieOptions(ctx.req.headers);
    const sameSiteVal = (opts.sameSite?.toLowerCase() ?? "strict") as "strict" | "lax" | "none";
    // Clear both possible cookie names (prod and dev)
    ctx.resHeaders.append(
      "set-cookie",
      cookie.serialize(Session.cookieName, "", {
        httpOnly: opts.httpOnly,
        path: opts.path,
        sameSite: sameSiteVal,
        secure: opts.secure,
        maxAge: 0,
      }),
    );
    ctx.resHeaders.append(
      "set-cookie",
      cookie.serialize(Session.prodCookieName, "", {
        httpOnly: opts.httpOnly,
        path: opts.path,
        sameSite: sameSiteVal,
        secure: true,
        maxAge: 0,
      }),
    );
    return { success: true };
  }),
});

