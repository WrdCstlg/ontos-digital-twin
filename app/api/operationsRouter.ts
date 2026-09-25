import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { jobs, workers } from "@db/schema";
import { createRouter, workspaceAdminMutation, workspaceAdminQuery, workspaceQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { actorLabelFor, writeAudit } from "./services/audit";
import { jobHandlers } from "./services/jobs/handlers";
import { cancelQueuedJob, getJob, requeueFailedJob } from "./services/jobs/queue";

/** A worker that has missed three heartbeats (every 5 s) is treated as gone. */
const STALE_AFTER_SECONDS = 15;

const JOB_STATUSES = ["queued", "running", "succeeded", "failed"] as const;

export const operationsRouter = createRouter({
  /** Queue depth for this workspace, and how many workers are serving it. */
  summary: workspaceQuery.query(async ({ ctx }) => {
    const db = getDb();
    const ws = ctx.workspace;
    const counts = await db
      .select({ status: jobs.status, n: sql<number>`count(*)` })
      .from(jobs)
      .where(eq(jobs.workspaceId, ws.id))
      .groupBy(jobs.status);
    const [oldest] = await db
      .select({ seconds: sql<number | null>`timestampdiff(second, min(${jobs.createdAt}), now())` })
      .from(jobs)
      .where(and(eq(jobs.workspaceId, ws.id), eq(jobs.status, "queued")));
    const [alive] = await db
      .select({ n: sql<number>`count(*)` })
      .from(workers)
      .where(
        and(
          eq(workers.status, "running"),
          sql`${workers.lastSeenAt} > now() - interval ${STALE_AFTER_SECONDS} second`,
        ),
      );
    const byStatus = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as Record<(typeof JOB_STATUSES)[number], number>;
    for (const c of counts) byStatus[c.status] = Number(c.n);
    return {
      byStatus,
      oldestQueuedSeconds: oldest?.seconds == null ? null : Number(oldest.seconds),
      workersAlive: Number(alive?.n ?? 0),
    };
  }),

  listJobs: workspaceQuery
    .input(
      z
        .object({
          status: z.enum(JOB_STATUSES).optional(),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      return getDb()
        .select()
        .from(jobs)
        .where(input?.status ? and(eq(jobs.workspaceId, ws.id), eq(jobs.status, input.status)) : eq(jobs.workspaceId, ws.id))
        .orderBy(desc(jobs.id))
        .limit(input?.limit ?? 50);
    }),

  getJob: workspaceQuery
    .input(z.object({ jobId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const job = await getJob(ctx.workspace.id, input.jobId);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: `Job ${input.jobId} not found` });
      return job;
    }),

  /** Workers are shared infrastructure, so their identities are for admins. */
  listWorkers: workspaceAdminQuery.query(async () => {
    const rows = await getDb()
      .select({
        id: workers.id,
        hostname: workers.hostname,
        version: workers.version,
        status: workers.status,
        currentJobId: workers.currentJobId,
        jobsSucceeded: workers.jobsSucceeded,
        jobsFailed: workers.jobsFailed,
        startedAt: workers.startedAt,
        lastSeenAt: workers.lastSeenAt,
        secondsSinceSeen: sql<number>`timestampdiff(second, ${workers.lastSeenAt}, now())`,
      })
      .from(workers)
      .orderBy(desc(workers.lastSeenAt))
      .limit(25);
    return rows.map((w) => ({
      ...w,
      secondsSinceSeen: Number(w.secondsSinceSeen),
      alive: w.status === "running" && Number(w.secondsSinceSeen) < STALE_AFTER_SECONDS,
    }));
  }),

  retryJob: workspaceAdminMutation
    .input(z.object({ jobId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const actor = actorLabelFor(ctx.user);
      const job = await requeueFailedJob(ctx.workspace.id, input.jobId, actor);
      if (!job) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Job ${input.jobId} is not a failed job in this workspace` });
      }
      await jobHandlers[job.kind]?.onRequeued?.(job);
      await writeAudit({
        workspaceId: ctx.workspace.id,
        actor,
        action: `Retried job #${job.id} (${job.kind})`,
        entityType: "job",
        entityId: job.id,
      });
      return job;
    }),

  cancelJob: workspaceAdminMutation
    .input(z.object({ jobId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const actor = actorLabelFor(ctx.user);
      const job = await cancelQueuedJob(ctx.workspace.id, input.jobId, actor);
      if (!job) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Job ${input.jobId} is not waiting in this workspace's queue; only a queued job can be cancelled`,
        });
      }
      await jobHandlers[job.kind]?.onFailed?.(job, `cancelled by ${actor}`);
      await writeAudit({
        workspaceId: ctx.workspace.id,
        actor,
        action: `Cancelled job #${job.id} (${job.kind})`,
        entityType: "job",
        entityId: job.id,
      });
      return job;
    }),
});
