import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "../router";
import { writeAudit } from "../services/audit";
import { jobHandlers } from "../services/jobs/handlers";
import { cancelQueuedJob, getJob, requeueFailedJob } from "../services/jobs/queue";
import { checkRunnableMapping, enqueueMappingSync } from "../services/mappingSync";
import {
  createMockContext,
  mockAdminMembership,
  mockAdminUser,
  mockOntologistMembership,
  mockOntologistUser,
  mockViewerMembership,
  mockViewerUser,
  mockWorkspace,
} from "./testHarness";

vi.mock("../services/mappingSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/mappingSync")>()),
  checkRunnableMapping: vi.fn(),
  enqueueMappingSync: vi.fn(),
}));
vi.mock("../services/jobs/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/jobs/queue")>()),
  requeueFailedJob: vi.fn(),
  cancelQueuedJob: vi.fn(),
  getJob: vi.fn(),
}));
vi.mock("../services/jobs/handlers", () => ({
  jobHandlers: {
    "mapping.sync": { run: vi.fn(), onRequeued: vi.fn(async () => {}), onFailed: vi.fn(async () => {}) },
  },
}));
vi.mock("../services/audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/audit")>()),
  writeAudit: vi.fn(async () => ({})),
}));

const as = (role: "viewer" | "ontologist" | "admin") =>
  appRouter.createCaller(
    createMockContext(
      role === "viewer"
        ? { user: mockViewerUser, membership: mockViewerMembership, workspace: mockWorkspace }
        : role === "ontologist"
          ? { user: mockOntologistUser, membership: mockOntologistMembership, workspace: mockWorkspace }
          : { user: mockAdminUser, membership: mockAdminMembership, workspace: mockWorkspace },
    ),
  );

const failedJob = { id: 31, workspaceId: mockWorkspace.id, kind: "mapping.sync", status: "queued", payloadJson: {} };

afterEach(() => {
  vi.clearAllMocks();
});

describe("mapping.runSync queues the import instead of running it", () => {
  it("refuses a viewer before anything is queued", async () => {
    await expect(as("viewer").mapping.runSync({ mappingId: 4 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(enqueueMappingSync).not.toHaveBeenCalled();
  });

  it("reports why a mapping cannot be imported, and queues nothing", async () => {
    vi.mocked(checkRunnableMapping).mockResolvedValue({ ok: false, code: "NOT_FOUND", message: "Mapping 4 not found" });

    await expect(as("ontologist").mapping.runSync({ mappingId: 4 })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Mapping 4 not found",
    });
    expect(checkRunnableMapping).toHaveBeenCalledWith(mockWorkspace.id, 4);
    expect(enqueueMappingSync).not.toHaveBeenCalled();
  });

  it("queues the import in the caller's workspace, as the caller, and returns the queued record", async () => {
    vi.mocked(checkRunnableMapping).mockResolvedValue({ ok: true, value: {} as never });
    const queued = { syncJob: { id: 21, status: "queued" }, jobId: 31, alreadyActive: false };
    vi.mocked(enqueueMappingSync).mockResolvedValue(queued as never);

    await expect(as("ontologist").mapping.runSync({ mappingId: 4 })).resolves.toEqual(queued);
    expect(enqueueMappingSync).toHaveBeenCalledWith(mockWorkspace.id, 4, mockOntologistUser.name);
  });
});

describe("operations: who may see and change the queue", () => {
  it("keeps workers, retry and cancel from non-admins", async () => {
    const viewer = as("viewer");
    await expect(viewer.operations.listWorkers()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(viewer.operations.retryJob({ jobId: 31 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as("ontologist").operations.cancelJob({ jobId: 31 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(requeueFailedJob).not.toHaveBeenCalled();
    expect(cancelQueuedJob).not.toHaveBeenCalled();
  });

  it("refuses to retry a job that is not failed", async () => {
    vi.mocked(requeueFailedJob).mockResolvedValue(null);
    await expect(as("admin").operations.retryJob({ jobId: 31 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(requeueFailedJob).toHaveBeenCalledWith(mockWorkspace.id, 31, mockAdminUser.name);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("retrying a failed job puts its import back in the queue and audits it", async () => {
    vi.mocked(requeueFailedJob).mockResolvedValue(failedJob as never);

    await as("admin").operations.retryJob({ jobId: 31 });

    expect(jobHandlers["mapping.sync"].onRequeued).toHaveBeenCalledWith(failedJob);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: mockWorkspace.id, action: "Retried job #31 (mapping.sync)", entityType: "job" }),
    );
  });

  it("cancelling a queued job fails its import with the canceller's name", async () => {
    vi.mocked(cancelQueuedJob).mockResolvedValue(failedJob as never);

    await as("admin").operations.cancelJob({ jobId: 31 });

    expect(jobHandlers["mapping.sync"].onFailed).toHaveBeenCalledWith(failedJob, `cancelled by ${mockAdminUser.name}`);
  });

  it("does not reveal a job outside the caller's workspace", async () => {
    vi.mocked(getJob).mockResolvedValue(null);
    await expect(as("viewer").operations.getJob({ jobId: 99 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(getJob).toHaveBeenCalledWith(mockWorkspace.id, 99);
  });
});
