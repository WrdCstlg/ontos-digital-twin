/**
 * The worker takes the engine lock around its engine work. Its replicas share
 * one engine (compose.yaml), so without it their imports' checks would clear
 * and load the engine under each other, and nothing else would notice.
 */
import { expect, it, vi } from "vitest";

vi.mock("@hono/node-server", () => ({ serve: vi.fn(() => ({ close: vi.fn() })) }));
vi.mock("../services/jobs/worker", () => ({
  JobWorker: vi.fn(function JobWorker() {
    return { id: "worker-test", start: vi.fn(), stop: vi.fn(), status: vi.fn() };
  }),
}));
vi.mock("../queries/connection", () => ({ getDb: vi.fn(), closeDb: vi.fn(), openConnection: vi.fn() }));
vi.mock("../lib/secretBox", () => ({ secretKey: vi.fn() }));

it("installs the engine lock when it starts", async () => {
  const { semanticEngine } = await import("../services/semanticEngine");
  const shareWith = vi.spyOn(semanticEngine, "shareWith");
  await import("../worker");
  expect(shareWith).toHaveBeenCalledTimes(1);
  expect(shareWith).toHaveBeenCalledWith(expect.any(Function));
});
