import { describe, expect, it } from "vitest";
import { SlidingWindowRateLimiter } from "../lib/rateLimit";

describe("SlidingWindowRateLimiter", () => {
  it("allows up to the limit in the window, then refuses", () => {
    const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 3 });
    expect([1, 2, 3, 4].map(() => limiter.check("ada").allowed)).toEqual([true, true, true, false]);
    expect(limiter.check("grace").allowed).toBe(true);
  });

  it("release takes back the latest attempt only, so an attempt that reached no verdict does not count", () => {
    const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 2 });
    limiter.check("ada");
    limiter.check("ada");
    limiter.release("ada");
    expect(limiter.check("ada").allowed).toBe(true);
    expect(limiter.check("ada").allowed).toBe(false);
  });

  it("release of a key with no attempts changes nothing", () => {
    const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 1 });
    limiter.release("nobody");
    expect(limiter.check("nobody").allowed).toBe(true);
    expect(limiter.check("nobody").allowed).toBe(false);
  });
});
