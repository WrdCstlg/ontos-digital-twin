/**
 * insights.runScan is limited per user, 10 runs a minute. Over the limit it is
 * refused with how long to wait, and a run the limit could not count is
 * answered 503. Neither touches the database the scan reads.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { RateLimitUnavailable, limitSubject, scanRateLimiter } from "../lib/rateLimit";
import { appRouter } from "../router";
import { createMockContext, mockViewerMembership, mockViewerUser } from "./testHarness";

// The limit runs against an in-memory rate_limit_windows (memoryRateLimits.ts);
// the scan's own database is not there, and says when it is asked.
const limits = vi.hoisted(() => ({ rows: new Map() }));
const scanDb = vi.hoisted(() => ({ asked: 0 }));
vi.mock("../queries/connection", async () => ({
  getPool: (await import("./memoryRateLimits")).memoryPoolFor(limits),
  getDb: () => {
    scanDb.asked++;
    throw new Error("the scan's database is not part of this test");
  },
}));

const viewer = () => appRouter.createCaller(createMockContext({ user: mockViewerUser, membership: mockViewerMembership }));
const viewerRow = `scan/${limitSubject(String(mockViewerUser.id))}`;

afterEach(() => {
  limits.rows.clear();
  scanDb.asked = 0;
  vi.restoreAllMocks();
});

describe("insights.runScan's limit", () => {
  it("counts a run with room and goes on to scan", async () => {
    await expect(viewer().insights.runScan()).rejects.toThrow("the scan's database is not part of this test");
    expect(limits.rows.get(viewerRow)?.hits).toHaveLength(1);
    expect(scanDb.asked).toBeGreaterThan(0);
  });

  it("refuses the eleventh run in a minute, saying how long to wait, without scanning", async () => {
    const now = Date.now();
    limits.rows.set(viewerRow, { hits: Array.from({ length: 10 }, (_, i) => now - 10_000 + i), updatedAt: now });
    await expect(viewer().insights.runScan()).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: expect.stringMatching(/^Insight scan rate limit exceeded\. Please wait (50|49) seconds\.$/),
    });
    expect(scanDb.asked).toBe(0);
  });

  it("answers 503 when the limit cannot be counted, never a refusal, and does not scan", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(scanRateLimiter, "check").mockRejectedValue(new RateLimitUnavailable("scan", new Error("connect ECONNREFUSED 172.19.0.3:3306")));
    await expect(viewer().insights.runScan()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: "The rate limit could not be checked just now. Try again in a moment.",
    });
    expect(scanDb.asked).toBe(0);
  });
});
