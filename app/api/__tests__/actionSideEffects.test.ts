import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@db/schema";
import { PermanentJobError } from "../services/jobs/worker";
import { actionWebhookHandler, assertDeliverable, isInternalAddress } from "../services/actions/sideEffects";

// Each select() in the handler ends in .limit(); these are its answers, in order.
const answers: unknown[][] = [];
vi.mock("../queries/connection", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => answers.shift() ?? [] }) }) }),
  }),
}));

const job = (payload: unknown): Job =>
  ({ id: 1, workspaceId: 1, kind: "action.webhook", payloadJson: payload, attempts: 1, maxAttempts: 3 }) as Job;

const submission = {
  id: 77,
  workspaceId: 1,
  actionTypeId: 5,
  actionKey: "renew-contract",
  actionVersion: 2,
  submittedBy: "R. Alvarez",
  paramsJson: { contract: "lgl:Contract/C-1" },
  resultJson: { modified: [] },
  createdAt: new Date("2026-09-24T10:00:00Z"),
};
const version = (url: string) => ({
  version: 2,
  definitionJson: {
    parameters: [],
    criteria: [],
    rules: [{ kind: "delete_object", object: "x" }],
    validation: { shacl: false },
    sideEffects: [{ kind: "webhook", url }],
  },
});

describe("isInternalAddress", () => {
  it.each([
    ["127.0.0.1", true],
    ["10.2.3.4", true],
    ["172.20.0.5", true],
    ["192.168.1.1", true],
    ["169.254.169.254", true],
    ["100.64.0.1", true],
    ["0.0.0.0", true],
    ["::1", true],
    ["fd00::1", true],
    ["fe80::1", true],
    ["::ffff:127.0.0.1", true],
    ["93.184.216.34", false],
    ["172.32.0.1", false],
    ["2606:4700::1111", false],
  ])("%s → %s", (ip, internal) => {
    expect(isInternalAddress(ip)).toBe(internal);
  });
});

describe("assertDeliverable", () => {
  it("refuses internal addresses unless they are allowed, and anything but http(s)", async () => {
    await expect(assertDeliverable("http://127.0.0.1:8080/hook", false)).rejects.toBeInstanceOf(PermanentJobError);
    await expect(assertDeliverable("http://[::1]/hook", false)).rejects.toBeInstanceOf(PermanentJobError);
    await expect(assertDeliverable("http://127.0.0.1:8080/hook", true)).resolves.toBeUndefined();
    await expect(assertDeliverable("ftp://example.com/x", true)).rejects.toThrow(/http or https/);
    await expect(assertDeliverable("http://93.184.216.34/hook", false)).resolves.toBeUndefined();
  });
});

describe("actionWebhookHandler", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    answers.length = 0;
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });
  const run = (payload: unknown = { submissionId: 77, index: 0 }) =>
    actionWebhookHandler.run({ job: job(payload), workerId: "w", signal: new AbortController().signal });

  it("posts the submission from the version it ran, with an idempotency key", async () => {
    answers.push([submission], [version("http://93.184.216.34/hook")]);
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(run()).resolves.toEqual({ url: "http://93.184.216.34/hook", status: 204 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://93.184.216.34/hook");
    expect(init.headers["idempotency-key"]).toBe("ontos-action-77-0");
    expect(init.redirect).toBe("manual");
    expect(JSON.parse(init.body)).toMatchObject({ event: "action.applied", submission: { id: 77, actionKey: "renew-contract", actionVersion: 2 } });
  });

  it("retries on a server error and gives up on a client error or a redirect", async () => {
    answers.push([submission], [version("http://93.184.216.34/hook")]);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const serverError = await run().catch((e) => e);
    expect(serverError).toBeInstanceOf(Error);
    expect(serverError).not.toBeInstanceOf(PermanentJobError);

    answers.push([submission], [version("http://93.184.216.34/hook")]);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(run()).rejects.toBeInstanceOf(PermanentJobError);

    answers.push([submission], [version("http://93.184.216.34/hook")]);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302 }));
    await expect(run()).rejects.toThrow(/redirects are not followed/);
  });

  it("never calls an internal address, and fails for good on a bad payload or a missing record", async () => {
    answers.push([submission], [version("http://10.0.0.8/hook")]);
    await expect(run()).rejects.toBeInstanceOf(PermanentJobError);
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(run({ nope: true })).rejects.toBeInstanceOf(PermanentJobError);
    answers.push([]);
    await expect(run()).rejects.toThrow(/submission 77 not found/);
  });
});
