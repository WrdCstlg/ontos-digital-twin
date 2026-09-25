import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { actionSubmissions, actionTypeVersions, jobs, kgNodes } from "@db/schema";
import { ACTION_ROLES, ACTION_STATUSES, actionDefinitionSchema, actionKeySchema, type ActionRole } from "@contracts/actions";
import { createRouter, requireWorkspaceRole, workspaceMutation, workspaceProcedure, workspaceQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { actorLabelFor } from "./services/audit";
import { hasWorkspaceRole } from "./services/workspaceGuard";
import { checkSubmitter } from "./services/actions/engine";
import {
  ActionTypeConflict,
  ActionTypeNotFound,
  DefinitionInvalid,
  createActionType,
  listActionTypes,
  listVersions,
  setActionTypeStatus,
  updateActionType,
  validateDefinition,
} from "./services/actions/definitions";
import {
  InvalidStoredDefinition,
  SubmissionConflict,
  classAncestors,
  listSubmissions,
  loadActionType,
  prepareSubmission,
  submitAction,
  summarisePlan,
  type Prepared,
  type SubmitterInfo,
} from "./services/actions/service";
import type { TrpcContext } from "./context";

/** Admins and ontologists define action types; any member may submit one their role allows. */
const authorProcedure = workspaceProcedure.use(requireWorkspaceRole(["admin", "ontologist"]));

const paramsInput = z
  .record(z.string().max(64), z.union([z.string().max(10_000), z.number(), z.boolean(), z.null()]))
  .refine((p) => Object.keys(p).length <= 50, "at most 50 parameters");

type Ctx = TrpcContext & {
  user: NonNullable<TrpcContext["user"]>;
  workspace: NonNullable<TrpcContext["workspace"]>;
  membership: NonNullable<TrpcContext["membership"]>;
};

function submitterOf(ctx: Ctx): SubmitterInfo {
  return {
    name: actorLabelFor(ctx.user),
    userId: ctx.user.id,
    userRole: ctx.user.role,
    memberRole: ctx.membership.role,
    moduleScope: ctx.membership.moduleScope,
  };
}

function rethrow(err: unknown): never {
  if (err instanceof DefinitionInvalid) throw new TRPCError({ code: "BAD_REQUEST", message: err.message, cause: err });
  if (err instanceof ActionTypeNotFound) throw new TRPCError({ code: "NOT_FOUND", message: err.message });
  if (err instanceof ActionTypeConflict) throw new TRPCError({ code: "CONFLICT", message: err.message });
  if (err instanceof SubmissionConflict) {
    throw new TRPCError({ code: "CONFLICT", message: "The objects changed while the action was being applied; review it and submit again" });
  }
  if (err instanceof InvalidStoredDefinition) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
  throw err;
}

async function loaded(workspaceId: number, key: string) {
  const l = await loadActionType(workspaceId, key).catch(rethrow);
  if (!l) throw new TRPCError({ code: "NOT_FOUND", message: `Action type "${key}" not found` });
  return l;
}

function outcome(prep: Prepared) {
  return {
    values: prep.values,
    problems: prep.problems,
    criteria: prep.criteria,
    plan: summarisePlan(prep.plan),
    shacl: prep.shacl,
  };
}

export const actionsRouter = createRouter({
  /** What the caller may do with action types: the client is not told its workspace role. */
  capabilities: workspaceQuery.query(({ ctx }) => ({
    canAuthor: hasWorkspaceRole(ctx.membership, ctx.user, ["admin", "ontologist"]),
  })),

  /** Every action type, with whether the caller may submit it. */
  listTypes: workspaceQuery.query(async ({ ctx }) => {
    const rows = await listActionTypes(ctx.workspace.id).catch(rethrow);
    const me = submitterOf(ctx);
    return rows.map((r) => {
      const denied = checkSubmitter(me, r.minRole as ActionRole, r.module.key);
      return { ...r, canSubmit: r.status === "active" && !denied, deniedBecause: denied?.message ?? null };
    });
  }),

  getType: workspaceQuery.input(z.object({ key: actionKeySchema })).query(async ({ ctx, input }) => {
    const l = await loaded(ctx.workspace.id, input.key);
    const denied = checkSubmitter(submitterOf(ctx), l.actionType.minRole as ActionRole, l.module.key);
    return {
      ...l.actionType,
      module: { key: l.module.key, name: l.module.name, color: l.module.color },
      definition: l.definition,
      canSubmit: l.actionType.status === "active" && !denied,
      deniedBecause: denied?.message ?? null,
      versions: await listVersions(ctx.workspace.id, input.key).catch(rethrow),
    };
  }),

  /** Active action types with an object parameter this object can fill, for acting from the object's page. */
  forObject: workspaceQuery.input(z.object({ iri: z.string().min(1).max(512) })).query(async ({ ctx, input }) => {
    const db = getDb();
    const [node] = await db
      .select({ classIri: kgNodes.classIri })
      .from(kgNodes)
      .where(and(eq(kgNodes.workspaceId, ctx.workspace.id), eq(kgNodes.iri, input.iri), isNull(kgNodes.deletedAt)))
      .limit(1);
    if (!node) return [];
    const classes = new Set([node.classIri, ...(await classAncestors(ctx.workspace.id))(node.classIri)]);
    const me = submitterOf(ctx);
    const rows = await listActionTypes(ctx.workspace.id).catch(rethrow);
    return rows.flatMap((r) => {
      if (r.status !== "active") return [];
      const param = r.definition.parameters.find((p) => p.type === "object" && classes.has(p.classIri));
      if (!param) return [];
      const denied = checkSubmitter(me, r.minRole as ActionRole, r.module.key);
      return [{ key: r.key, displayName: r.displayName, description: r.description, module: r.module, paramName: param.name, canSubmit: !denied, deniedBecause: denied?.message ?? null }];
    });
  }),

  validateDefinition: authorProcedure.input(z.object({ definition: z.unknown() })).mutation(({ input }) => {
    const { problems } = validateDefinition(input.definition);
    return { ok: problems.length === 0, problems };
  }),

  createType: authorProcedure
    .input(
      z.object({
        key: actionKeySchema,
        displayName: z.string().min(1).max(255),
        description: z.string().max(5000).nullish(),
        moduleKey: z.string().min(1).max(64),
        minRole: z.enum(ACTION_ROLES),
        status: z.enum(ACTION_STATUSES),
        definition: z.unknown(),
      }),
    )
    .mutation(({ ctx, input }) => createActionType(ctx.workspace.id, actorLabelFor(ctx.user), input).catch(rethrow)),

  updateType: authorProcedure
    .input(
      z.object({
        key: actionKeySchema,
        expectedVersion: z.number().int().min(1),
        displayName: z.string().min(1).max(255).optional(),
        description: z.string().max(5000).nullish(),
        minRole: z.enum(ACTION_ROLES).optional(),
        definition: z.unknown().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { key, ...change } = input;
      return updateActionType(ctx.workspace.id, actorLabelFor(ctx.user), key, change).catch(rethrow);
    }),

  setStatus: authorProcedure
    .input(z.object({ key: actionKeySchema, status: z.enum(ACTION_STATUSES) }))
    .mutation(({ ctx, input }) => setActionTypeStatus(ctx.workspace.id, actorLabelFor(ctx.user), input.key, input.status).catch(rethrow)),

  /** Everything a submission would do and every reason it would be refused, without doing it. */
  preview: workspaceMutation
    .input(z.object({ key: actionKeySchema, params: paramsInput }))
    .mutation(async ({ ctx, input }) => {
      const l = await loaded(ctx.workspace.id, input.key);
      const prep = await prepareSubmission(ctx.workspace.id, l, submitterOf(ctx), input.params).catch(rethrow);
      return { ...outcome(prep), canApply: prep.problems.length === 0 };
    }),

  /**
   * Applies the action, or records why it was not applied. A rejection is an
   * answer, not an error; only a permission refusal throws.
   */
  submit: workspaceMutation
    .input(z.object({ key: actionKeySchema, params: paramsInput }))
    .mutation(async ({ ctx, input }) => {
      const l = await loaded(ctx.workspace.id, input.key);
      const { submission, prepared } = await submitAction(ctx.workspace.id, l, submitterOf(ctx), input.params).catch(rethrow);
      if (!submission) {
        const why = prepared.problems[0];
        throw new TRPCError({ code: why?.code === "action_inactive" ? "BAD_REQUEST" : "FORBIDDEN", message: why?.message ?? "Not allowed" });
      }
      return { submission, ...outcome(prepared) };
    }),

  listSubmissions: workspaceQuery
    .input(
      z
        .object({
          actionKey: actionKeySchema.optional(),
          status: z.enum(["applied", "rejected"]).optional(),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .optional(),
    )
    .query(({ ctx, input }) => listSubmissions(ctx.workspace.id, { limit: 50, ...input })),

  getSubmission: workspaceQuery.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const db = getDb();
    const [submission] = await db
      .select()
      .from(actionSubmissions)
      .where(and(eq(actionSubmissions.id, input.id), eq(actionSubmissions.workspaceId, ctx.workspace.id)))
      .limit(1);
    if (!submission) throw new TRPCError({ code: "NOT_FOUND", message: `Submission ${input.id} not found` });
    const jobIds = Array.isArray(submission.sideEffectJobIds) ? (submission.sideEffectJobIds as number[]) : [];
    const sideEffects = jobIds.length
      ? await db
          .select({ id: jobs.id, status: jobs.status, attempts: jobs.attempts, maxAttempts: jobs.maxAttempts, lastError: jobs.lastError, result: jobs.resultJson, finishedAt: jobs.finishedAt })
          .from(jobs)
          .where(and(inArray(jobs.id, jobIds), eq(jobs.workspaceId, ctx.workspace.id)))
      : [];
    // The definition as it was when this submission ran, for its labels.
    const [version] = await db
      .select({ definitionJson: actionTypeVersions.definitionJson })
      .from(actionTypeVersions)
      .where(and(eq(actionTypeVersions.actionTypeId, submission.actionTypeId), eq(actionTypeVersions.version, submission.actionVersion)))
      .limit(1);
    const parsed = version ? actionDefinitionSchema.safeParse(version.definitionJson) : null;
    return { submission, sideEffects, definition: parsed?.success ? parsed.data : null };
  }),
});
