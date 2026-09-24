import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "../router";
import { isReadOnlySparql } from "../lib/sparqlGuard";
import { nlqRateLimiter } from "../lib/rateLimit";
import { llmGateway } from "../services/llmGateway";
import type { LlmProvider } from "../services/llmGateway";
import { semanticEngine } from "../services/semanticEngine";
import { createMockContext, mockAdminUser, mockViewerUser } from "./testHarness";

// The semantic engine is an external daemon: record what would be sent to it.
vi.mock("../services/semanticEngine", () => ({
  semanticEngine: {
    ensureEngineRunning: vi.fn().mockResolvedValue(true),
    exclusive: vi.fn((task: () => Promise<unknown>) => task()),
    syncWorkspace: vi.fn().mockResolvedValue(undefined),
    ensureWorkspaceLoaded: vi.fn().mockResolvedValue(undefined),
    querySparql: vi.fn().mockResolvedValue({ variables: ["s"], results: [] }),
    updateSparql: vi.fn().mockResolvedValue({ ok: true, affected: 0 }),
  },
}));

// executeGenerated loads the workspace graph before running an intent: an empty graph.
vi.mock("../queries/connection", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () =>
          Object.assign(Promise.resolve([]), {
            orderBy: () => ({ limit: () => Promise.resolve([]) }),
          }),
      }),
    }),
  }),
}));

/** A stand-in LLM provider whose completion text the test controls. */
function fakeProvider(text: string): LlmProvider {
  return {
    id: "test-llm",
    label: "Test LLM",
    isConfigured: () => true,
    getModel: () => "test-model",
    complete: vi.fn(async () => ({ text, providerId: "test-llm", model: "test-model", latencyMs: 1 })),
    checkHealth: async () => ({ ok: true }),
  };
}

const viewerCaller = () => appRouter.createCaller(createMockContext({ user: mockViewerUser }));

beforeEach(() => {
  vi.clearAllMocks();
  nlqRateLimiter.reset(String(mockViewerUser.id));
  nlqRateLimiter.reset(String(mockAdminUser.id));
  // No LLM unless a test installs one (the default Ollama provider would hit the network).
  vi.spyOn(llmGateway, "getActiveProvider").mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

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
    expect(isReadOnlySparql(result.sparql!)).toBe(true);
    expect(result.sparql).toContain("fin:paidTo");
  });

  it("rejects unauthenticated requests to translate", async () => {
    const caller = appRouter.createCaller(createMockContext({ user: null }));
    await expect(
      caller.nlq.translate({ question: "any question" }),
    ).rejects.toThrow("Authentication required");
  });
});

describe("NLQ read-only guarantees", () => {
  describe("translate", () => {
    it("refuses destructive or write-shaped questions, emits no SPARQL, and never consults the LLM", async () => {
      const generate = vi.spyOn(llmGateway, "generateSparql");
      const questions = [
        "delete all vendors",
        "drop the hr module",
        "insert a new employee named Mallory",
        "update every contract status to active",
        "truncate the audit log",
        "remove every compliance policy",
        "show me all salaries",
        "vendors with payments UNION ALL SELECT * FROM users",
      ];

      for (const question of questions) {
        const result = await viewerCaller().nlq.translate({ question });
        expect(result.recognized, question).toBe(false);
        expect(result.refusal, question).toMatch(/read-only/);
        expect(result.sparql, question).toBeUndefined();
      }
      expect(generate).not.toHaveBeenCalled();
    });

    it("emits SPARQL that passes the read-only guard for every simulator intent", async () => {
      const cases: Array<[string, string]> = [
        ["employees who signed contracts governed by policies with open audit findings", "employees-signing-contracts-with-open-findings"],
        ["vendors with payments but no active contract", "vendors-with-payments-no-contract"],
        ["spend by cost center", "spend-by-cost-center"],
        ["shipments delayed this week", "shipments-delayed"],
        ["who reports to Dana Whitfield", "who-reports-to"],
        ["how many instances per module", "count-by-module"],
        ["employees with no manager", "orphan-employees"],
        ["controls lacking evidence for 90+ days", "controls-without-evidence"],
        ["show spend without a cost center", "spend-without-cost-center"],
        ["contracts in jurisdiction Delaware", "contracts-by-jurisdiction"],
        ["top vendors by spend", "top-vendors-by-spend"],
        ["what changed this week", "what-changed"],
        ["show me Acme Logistics", "node-lookup"],
      ];

      for (const [question, intent] of cases) {
        const result = await viewerCaller().nlq.translate({ question });
        expect(result.intent, question).toBe(intent);
        expect(result.sparql!.startsWith(`# intent:${intent}\n`), question).toBe(true);
        expect(isReadOnlySparql(result.sparql!), question).toBe(true);
      }
    });

    it("does not let quotes in a lookup term break out of the generated SPARQL literal", async () => {
      const result = await viewerCaller().nlq.translate({
        question: 'lookup x")) } CLEAR ALL #',
      });

      expect(result.intent).toBe("node-lookup");
      // normalize() turns the quote into a space; the rest stays inside the literal.
      expect(result.bindings?.term).toBe("x )) } clear all #");
      expect(isReadOnlySparql(result.sparql!)).toBe(true);
    });

    it("escapes a backslash in a lookup term so it cannot swallow the closing quote", async () => {
      const result = await viewerCaller().nlq.translate({ question: "show me x\\" });

      expect(result.bindings?.term).toBe("x\\");
      expect(result.sparql).toContain(String.raw`CONTAINS(LCASE(?label), "x\\"))`);
      expect(result.cypher).toContain(String.raw`CONTAINS "x\\" RETURN`);
    });

    it("refuses LLM output that is not read-only", async () => {
      const unsafeOutputs = [
        "```sparql\nDELETE WHERE { ?s ?p ?o }\n```\nExplanation: wipes the graph",
        "```sparql\nSELECT * WHERE { ?s ?p ?o } ; DROP ALL\n```\nExplanation: smuggled update",
        "Sure. SELECT * WHERE { ?s ?p ?o } INSERT DATA { <a> <b> <c> }",
        "```sparql\n# SELECT ?s\nCLEAR DEFAULT\n```",
      ];

      for (const text of unsafeOutputs) {
        vi.mocked(llmGateway.getActiveProvider).mockReturnValue(fakeProvider(text));
        const result = await viewerCaller().nlq.translate({
          question: "list every carrier alongside its routes",
        });
        expect(result.recognized, text).toBe(false);
        expect(result.refusal, text).toMatch(/Refused/);
        expect(result.sparql, text).toBeUndefined();
      }
    });
  });

  describe("execute", () => {
    it("runs guarded LLM SPARQL end to end, sending only read-only SPARQL to the engine's query channel", async () => {
      vi.mocked(llmGateway.getActiveProvider).mockReturnValue(
        fakeProvider(
          "```sparql\nSELECT ?carrier WHERE { ?carrier a <https://ontos.enterprise/schema/logistics#Carrier> }\n```\nExplanation: all carriers",
        ),
      );
      const caller = viewerCaller();

      const translated = await caller.nlq.translate({ question: "list every carrier alongside its routes" });
      expect(translated.intent).toBe("llm-generated");
      expect(isReadOnlySparql(translated.sparql!)).toBe(true);

      const executed = await caller.nlq.execute({ sparql: translated.sparql! });
      expect(executed.intent).toBe("llm-generated");

      const sent = vi.mocked(semanticEngine.querySparql).mock.calls.map(([q]) => q);
      expect(sent).toEqual([translated.sparql]);
      expect(sent.every((q) => isReadOnlySparql(q))).toBe(true);
      expect(semanticEngine.updateSparql).not.toHaveBeenCalled();
    });

    it("refuses update statements sent straight to execute, whatever intent marker they carry", async () => {
      const updates = [
        "INSERT DATA { <a> <b> <c> }",
        "# intent:llm-generated\nDELETE WHERE { ?s ?p ?o }",
        "# intent:llm-generated\nSELECT * WHERE { ?s ?p ?o }\nCLEAR DEFAULT",
        "# intent:node-lookup\nSELECT * WHERE { ?s ?p ?o } ; DROP ALL",
        "# intent:llm-generated\nWITH <urn:g> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }",
      ];

      for (const sparql of updates) {
        await expect(viewerCaller().nlq.execute({ sparql }), sparql).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: expect.stringMatching(/^Refused/),
        });
      }
      expect(semanticEngine.querySparql).not.toHaveBeenCalled();
      expect(semanticEngine.updateSparql).not.toHaveBeenCalled();
    });

    it("refuses SPARQL that lacks a known simulator intent marker", async () => {
      for (const sparql of [
        "SELECT * WHERE { ?s ?p ?o }",
        "# intent:exfiltrate-everything\nSELECT * WHERE { ?s ?p ?o }",
      ]) {
        await expect(viewerCaller().nlq.execute({ sparql }), sparql).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: expect.stringContaining("intent marker"),
        });
      }
      expect(semanticEngine.querySparql).not.toHaveBeenCalled();
    });

    it("refuses updates hidden from a line-based comment filter, and never reaches the engine", async () => {
      const smuggled = [
        // A "#" comment ends at CR in SPARQL, so DROP ALL is live code here.
        "# intent:llm-generated\nSELECT * WHERE { ?s ?p ?o }\n#\rDROP ALL\n",
        // A line inside a multi-line string literal that merely starts with "#".
        '# intent:llm-generated\nSELECT * WHERE { ?s ?p """\n# """ } ; DROP ALL ; SELECT * WHERE { ?s ?p ?o\n}',
      ];

      for (const sparql of smuggled) {
        await expect(viewerCaller().nlq.execute({ sparql }), sparql).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: expect.stringMatching(/^Refused/),
        });
      }
      expect(semanticEngine.querySparql).not.toHaveBeenCalled();
    });
  });
});
