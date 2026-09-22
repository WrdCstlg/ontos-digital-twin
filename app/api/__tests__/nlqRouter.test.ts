import { describe, expect, it } from "vitest";
import { appRouter } from "../router";
import { createMockContext, mockAdminUser, mockViewerUser } from "./testHarness";

describe("NLQ Router Integration Tests", () => {
  it("returns suggestions list for authenticated caller", async () => {
    const caller = appRouter.createCaller(createMockContext({ user: mockViewerUser }));
    const suggestions = await caller.nlq.suggestions();
    expect(Array.isArray(suggestions)).toBe(true);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(typeof suggestions[0]).toBe("string");
  });

  it("translates a known query intent deterministically", async () => {
    const caller = appRouter.createCaller(createMockContext({ user: mockAdminUser }));
    const result = await caller.nlq.translate({
      question: "Show all active contracts expiring in 30 days",
    });

    expect(result).toHaveProperty("intent");
    expect(result).toHaveProperty("sparql");
    expect(result.sparql).toBeDefined();
    expect(result.sparql!.toLowerCase()).toContain("select");
  });

  it("translates vendor payments query to expected SPARQL", async () => {
    const caller = appRouter.createCaller(createMockContext({ user: mockViewerUser }));
    const result = await caller.nlq.translate({
      question: "Which vendors have payments but no contract?",
    });

    expect(result.intent).toBe("vendors-with-payments-no-contract");
    expect(result.sparql).toBeDefined();
    expect(result.sparql).toContain("SELECT");
    expect(result.sparql).toContain("fin:paidTo");
  });

  it("rejects unauthenticated requests to translate", async () => {
    const caller = appRouter.createCaller(createMockContext({ user: null }));
    await expect(
      caller.nlq.translate({ question: "any question" }),
    ).rejects.toThrow("Authentication required");
  });
});
