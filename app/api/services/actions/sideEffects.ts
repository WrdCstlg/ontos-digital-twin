import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, eq } from "drizzle-orm";
import { actionSubmissions, actionTypeVersions } from "@db/schema";
import { actionDefinitionSchema } from "@contracts/actions";
import { getDb } from "../../queries/connection";
import { PermanentJobError, type JobHandler } from "../jobs/worker";

/**
 * Side effects of applied actions, run by the worker after the edits commit:
 * today, a webhook POST of the submission. Delivery is at least once (a retry
 * after a timeout may repeat a POST that arrived), so every request carries an
 * Idempotency-Key the receiver can deduplicate on.
 *
 * The worker will not call loopback, private, link-local or other internal
 * addresses unless ACTION_WEBHOOK_ALLOW_PRIVATE=true, so an action definition
 * cannot point it at services inside the network. The address is checked when
 * the job runs; a DNS answer that changes between the check and the request
 * is not caught.
 */

export const ACTION_WEBHOOK_KIND = "action.webhook";

const TIMEOUT_MS = 10_000;

type Payload = { submissionId: number; index: number };

function readPayload(raw: unknown): Payload {
  const p = raw as Partial<Payload> | null;
  if (!p || typeof p.submissionId !== "number" || typeof p.index !== "number") {
    throw new PermanentJobError("side-effect job has no submissionId/index in its payload");
  }
  return { submissionId: p.submissionId, index: p.index };
}

/** True for addresses a webhook must not reach: loopback, private, link-local, CGNAT, multicast, unspecified. */
export function isInternalAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isInternalAddress(mapped[1]);
    return (
      x === "::" ||
      x === "::1" ||
      x.startsWith("fc") ||
      x.startsWith("fd") ||
      /^fe[89ab]/.test(x) ||
      x.startsWith("ff")
    );
  }
  return true;
}

/** Refuses a URL whose host resolves to an internal address, unless those are allowed. */
export async function assertDeliverable(url: string, allowInternal = process.env.ACTION_WEBHOOK_ALLOW_PRIVATE === "true"): Promise<void> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new PermanentJobError(`not a URL: ${url}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new PermanentJobError(`webhooks use http or https, not ${u.protocol}`);
  if (allowInternal) return;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new Error(`cannot resolve ${host}`);
  const internal = addrs.find((a) => isInternalAddress(a.address));
  if (internal) {
    throw new PermanentJobError(`${host} resolves to ${internal.address}, an internal address; set ACTION_WEBHOOK_ALLOW_PRIVATE=true to allow it`);
  }
}

export const actionWebhookHandler: JobHandler = {
  async run({ job, signal }) {
    const { submissionId, index } = readPayload(job.payloadJson);
    const db = getDb();
    const [submission] = await db
      .select()
      .from(actionSubmissions)
      .where(and(eq(actionSubmissions.id, submissionId), eq(actionSubmissions.workspaceId, job.workspaceId)))
      .limit(1);
    if (!submission) throw new PermanentJobError(`submission ${submissionId} not found`);
    // The side effects of the version the submission ran, not of whatever is current.
    const [version] = await db
      .select()
      .from(actionTypeVersions)
      .where(and(eq(actionTypeVersions.actionTypeId, submission.actionTypeId), eq(actionTypeVersions.version, submission.actionVersion)))
      .limit(1);
    if (!version) throw new PermanentJobError(`version ${submission.actionVersion} of action ${submission.actionKey} not found`);
    const def = actionDefinitionSchema.safeParse(version.definitionJson);
    const effect = def.success ? def.data.sideEffects[index] : undefined;
    if (!effect) throw new PermanentJobError(`action ${submission.actionKey} v${submission.actionVersion} has no side effect ${index}`);

    await assertDeliverable(effect.url);
    const res = await fetch(effect.url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
      headers: {
        "content-type": "application/json",
        "user-agent": "Ontos-Actions/1",
        "x-ontos-event": "action.applied",
        "idempotency-key": `ontos-action-${submission.id}-${index}`,
      },
      body: JSON.stringify({
        event: "action.applied",
        workspaceId: submission.workspaceId,
        submission: {
          id: submission.id,
          actionKey: submission.actionKey,
          actionVersion: submission.actionVersion,
          submittedBy: submission.submittedBy,
          params: submission.paramsJson,
          result: submission.resultJson,
          createdAt: submission.createdAt,
        },
      }),
    });
    if (res.ok) return { url: effect.url, status: res.status };
    const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
    const message = `webhook ${effect.url} answered HTTP ${res.status}`;
    if (retryable) throw new Error(message);
    throw new PermanentJobError(res.status >= 300 && res.status < 400 ? `${message} (redirects are not followed)` : message);
  },
};
