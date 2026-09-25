import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User, Workspace, WorkspaceMember } from "@db/schema";
import { sessionUser } from "./auth/service";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: User;
  workspace?: Workspace;
  membership?: WorkspaceMember;
  /**
   * The request carried a session that could not be checked (the database was
   * unreachable, say). Signed-in procedures then answer 503, not 401: the
   * person may well be signed in.
   */
  sessionUnavailable?: boolean;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };
  try {
    // Authentication is optional here: public procedures run without a user.
    ctx.user = (await sessionUser(opts.req.headers)) ?? undefined;
  } catch (err) {
    ctx.sessionUnavailable = true;
    console.warn("[auth] session could not be checked:", err instanceof Error ? err.message : String(err));
  }
  return ctx;
}
