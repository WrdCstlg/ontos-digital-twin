/**
 * What each member sees of the queue (services/jobs/jobView.ts): worker
 * identities only admins, webhook addresses in full only those who author
 * action types. Messages are built by the queue's own builders, so a change
 * in its wording that the view would miss fails here.
 */
import { describe, expect, it } from "vitest";
import type { Job, WorkspaceMember } from "@db/schema";
import { jobAudience, jobErrorFor, jobFor, withoutWorkerNames, workerFor, type JobAudience } from "../services/jobs/jobView";
import { leaseLapse } from "../services/jobs/queue";
import { mockAdminUser, mockViewerUser } from "./testHarness";

const HOOK = "https://hooks.slack.com/services/T000/B000/SENTINEL-HOOK";
const W1 = "prod-worker-7-4242-abcd1234";
const W2 = "prod-worker-9-77-ffff0000";
const at = new Date("2026-01-01T00:00:00Z");

const viewer: JobAudience = { workers: false, webhookUrls: false };
const author: JobAudience = { workers: false, webhookUrls: true };
const admin: JobAudience = { workers: true, webhookUrls: true };

describe("withoutWorkerNames", () => {
  it("leaves out every worker the queue's lease messages name", () => {
    expect(withoutWorkerNames(leaseLapse.abandoned(W1, 3, 3))).toBe(
      "lease held by a worker expired on attempt 3 of 3; the worker stopped responding",
    );
    expect(withoutWorkerNames(leaseLapse.reclaimed(W1, W2))).toBe("lease held by a worker expired; reclaimed by another worker");
  });

  it("leaves a message that names no worker as it is", () => {
    const unnamed = leaseLapse.abandoned(null, 2, 3);
    expect(withoutWorkerNames(unnamed)).toBe(unnamed);
    expect(withoutWorkerNames(leaseLapse.reclaimed(null, W2))).toBe("lease held by a worker expired; reclaimed by another worker");
    expect(withoutWorkerNames("webhook answered HTTP 500")).toBe("webhook answered HTTP 500");
  });
});

describe("jobErrorFor", () => {
  const message = `webhook ${HOOK} answered HTTP 500; ${leaseLapse.reclaimed(W1, W2)}`;

  it("shows each detail only to whom it is for", () => {
    expect(jobErrorFor(message, viewer)).toBe(
      "webhook https://*.slack.com/… answered HTTP 500; lease held by a worker expired; reclaimed by another worker",
    );
    expect(jobErrorFor(message, author)).toBe(
      `webhook ${HOOK} answered HTTP 500; lease held by a worker expired; reclaimed by another worker`,
    );
    expect(jobErrorFor(message, admin)).toBe(message);
  });

  it("keeps no error as none", () => {
    expect(jobErrorFor(null, viewer)).toBeNull();
    expect(jobErrorFor(undefined, admin)).toBeNull();
  });
});

describe("jobFor", () => {
  const job = (kind: string): Job =>
    ({
      id: 1, workspaceId: 1, kind, status: "running", attempts: 2, maxAttempts: 3, payloadJson: {}, leaseOwner: W2, leaseExpiresAt: at,
      lastError: leaseLapse.reclaimed(W1, W2), resultJson: { url: HOOK, status: 200 }, createdBy: "a", createdAt: at, startedAt: at,
      finishedAt: null, runAfter: at,
    }) as unknown as Job;

  it("hides the lease holder and the names in its error from all but admins", () => {
    for (const a of [viewer, author]) {
      const seen = jobFor(job("mapping.sync"), a);
      expect(seen.leaseOwner).toBeNull();
      expect(JSON.stringify(seen)).not.toContain("prod-worker");
    }
    expect(jobFor(job("mapping.sync"), admin)).toEqual(job("mapping.sync"));
  });

  it("redacts a webhook delivery's address for non-authors, and leaves other jobs' results alone", () => {
    expect(jobFor(job("action.webhook"), viewer).resultJson).toEqual({ url: "https://*.slack.com/…", status: 200 });
    expect(jobFor(job("action.webhook"), author).resultJson).toEqual({ url: HOOK, status: 200 });
    expect(jobFor(job("mapping.sync"), viewer).resultJson).toEqual({ url: HOOK, status: 200 });
  });
});

describe("workerFor", () => {
  it("names the job a worker runs only when it is this workspace's; another's leaves it just busy", () => {
    const worker = (currentJobId: number | null) => ({ id: "w-1", currentJobId });
    const own = new Set([41]);
    expect(workerFor(worker(41), own)).toEqual({ id: "w-1", currentJobId: 41, busyElsewhere: false });
    expect(workerFor(worker(99), own)).toEqual({ id: "w-1", currentJobId: null, busyElsewhere: true });
    expect(workerFor(worker(null), own)).toEqual({ id: "w-1", currentJobId: null, busyElsewhere: false });
  });
});

describe("jobAudience", () => {
  const member = (role: WorkspaceMember["role"]): WorkspaceMember => ({ id: 1, workspaceId: 1, userId: mockViewerUser.id, role, moduleScope: null, createdAt: at });

  it("follows the workspace role: admins see workers, authors see webhook addresses", () => {
    expect(jobAudience(member("viewer"), mockViewerUser)).toEqual(viewer);
    expect(jobAudience(member("editor"), mockViewerUser)).toEqual(viewer);
    expect(jobAudience(member("ontologist"), mockViewerUser)).toEqual(author);
    expect(jobAudience(member("admin"), mockViewerUser)).toEqual(admin);
  });

  it("and a platform admin sees what a workspace admin does, whatever their membership", () => {
    expect(jobAudience(member("viewer"), mockAdminUser)).toEqual(admin);
  });
});
