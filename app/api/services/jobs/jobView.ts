import type { Job, User, WorkspaceMember } from "@db/schema";
import { hasWorkspaceRole } from "../workspaceGuard";
import { ACTION_WEBHOOK_KIND } from "../actions/sideEffects";
import { ACTION_AUTHOR_ROLES, redactDeliveryResult, redactUrlsIn } from "../actions/webhookView";

/**
 * What a member sees of the queue, wherever it shows. A job's error travels
 * beyond the job: into the sync job it ran (mapping.listSyncJobs,
 * dashboard.overview) and into an action submission's side effects
 * (actions.getSubmission). Every route that returns one passes it through
 * here, so each kind of detail has one rule:
 * - worker identities (host, pid and a nonce) are for workspace admins, as
 *   operations.listWorkers is. The queue names workers in the messages it
 *   writes when a lease lapses (queue.ts, leaseLapse);
 * - a webhook's address, often its credential, is for those who may author
 *   action types, who wrote it in; everyone else sees where it goes
 *   (actions/webhookView.ts).
 */
export type JobAudience = {
  /** Sees worker identities: a workspace admin. */
  workers: boolean;
  /** Sees webhook addresses in full: a member who may author action types. */
  webhookUrls: boolean;
};

export function jobAudience(membership: WorkspaceMember, user: User): JobAudience {
  return {
    workers: hasWorkspaceRole(membership, user, ["admin"]),
    webhookUrls: hasWorkspaceRole(membership, user, ACTION_AUTHOR_ROLES),
  };
}

/** A queue message with the workers it names left out; "a worker" names none. */
export function withoutWorkerNames(text: string): string {
  return text
    .replace(/lease held by (?!a worker\b)\S+/g, "lease held by a worker")
    .replace(/reclaimed by \S+/g, "reclaimed by another worker");
}

/** A job's error, or a sync job's copy of it, as this audience may read it. */
export function jobErrorFor(text: string | null | undefined, audience: JobAudience): string | null {
  if (text === null || text === undefined) return null;
  const shown = audience.webhookUrls ? text : redactUrlsIn(text);
  return audience.workers ? shown : withoutWorkerNames(shown);
}

/** A job as this audience may see it. */
export function jobFor(job: Job, audience: JobAudience): Job {
  return {
    ...job,
    leaseOwner: audience.workers ? job.leaseOwner : null,
    lastError: jobErrorFor(job.lastError, audience),
    resultJson: job.kind === ACTION_WEBHOOK_KIND && !audience.webhookUrls ? redactDeliveryResult(job.resultJson) : job.resultJson,
  };
}
