import { beforeEach, describe, expect, it } from "vitest";
import {
  LlmGateway,
  OllamaProvider,
  OpenAiProvider,
  AnthropicProvider,
  OpenRouterProvider,
  type LlmProvider,
} from "../services/llmGateway";
import { translate } from "../services/nlq";

describe("Pluggable LLM Gateway Suite", () => {
  let gateway: LlmGateway;

  beforeEach(() => {
    gateway = new LlmGateway();
  });

  describe("Provider Configuration and Masking", () => {
    it("reports unconfigured when API keys are missing", () => {
      const openai = new OpenAiProvider(undefined);
      expect(openai.isConfigured()).toBe(false);
      expect(openai.getMaskedKey()).toBeUndefined();

      const anthropic = new AnthropicProvider(undefined);
      expect(anthropic.isConfigured()).toBe(false);

      const openrouter = new OpenRouterProvider(undefined);
      expect(openrouter.isConfigured()).toBe(false);
    });

    it("masks API keys properly when configured", () => {
      const openai = new OpenAiProvider("sk-proj-1234567890abcdef");
      expect(openai.isConfigured()).toBe(true);
      const masked = openai.getMaskedKey();
      expect(masked).toBeDefined();
      expect(masked).toContain("...");
      expect(masked?.endsWith("cdef")).toBe(true);
      expect(masked).not.toContain("1234567890");
    });

    it("defaults Ollama to local URL and preserves model configuration", () => {
      const ollama = new OllamaProvider();
      expect(ollama.isConfigured()).toBe(true);
      expect(ollama.getEndpoint()).toContain("11434");
      expect(ollama.getModel()).toBeTruthy();
    });
  });

  describe("Gateway Provider Statuses", () => {
    it("returns status for all 4 standard providers", async () => {
      const statuses = await gateway.getProviderStatuses();
      expect(statuses).toHaveLength(4);
      const ids = statuses.map((s) => s.id);
      expect(ids).toContain("ollama");
      expect(ids).toContain("openai");
      expect(ids).toContain("anthropic");
      expect(ids).toContain("openrouter");

      for (const s of statuses) {
        expect(["active", "configured", "unconfigured"]).toContain(s.status);
      }
    });

    it("allows switching active provider", () => {
      gateway.setActiveProvider("openai");
      const active = gateway.getActiveProvider();
      expect(active?.id).toBe("openai");

      gateway.setActiveProvider("ollama");
      expect(gateway.getActiveProvider()?.id).toBe("ollama");
    });
  });

  describe("SPARQL Generation and AST Guardrails", () => {
    it("successfully extracts and validates read-only SELECT SPARQL query", async () => {
      const mockProvider: LlmProvider = {
        id: "mock-llm",
        label: "Mock LLM",
        isConfigured: () => true,
        getModel: () => "mock-model",
        complete: async () => ({
          text: `Here is the query:
\`\`\`sparql
PREFIX hr: <https://ontos.enterprise/schema/hr#>
SELECT ?person ?dept WHERE {
  ?person a hr:Person ; hr:inDepartment ?dept .
}
\`\`\`
Explanation: Lists all people and their departments.`,
          providerId: "mock-llm",
          model: "mock-model",
          latencyMs: 85,
        }),
        checkHealth: async () => ({ ok: true }),
      };

      gateway.registerProvider(mockProvider);
      gateway.setActiveProvider("mock-llm");

      const res = await gateway.generateSparql("List all people and their departments");
      expect(res).not.toBeNull();
      expect(res?.sparql).toContain("SELECT ?person ?dept");
      expect(res?.explanation).toContain("Lists all people");
      expect(res?.providerId).toBe("mock-llm");
    });

    it("STRICT VETO: Rejects queries containing mutation keywords (INSERT/DELETE/DROP)", async () => {
      const maliciousProvider: LlmProvider = {
        id: "malicious-llm",
        label: "Malicious LLM",
        isConfigured: () => true,
        getModel: () => "mock-model",
        complete: async () => ({
          text: `\`\`\`sparql
PREFIX hr: <https://ontos.enterprise/schema/hr#>
DELETE WHERE { ?person a hr:Person }
\`\`\`
Explanation: Deletes all people.`,
          providerId: "malicious-llm",
          model: "mock-model",
          latencyMs: 50,
        }),
        checkHealth: async () => ({ ok: true }),
      };

      gateway.registerProvider(maliciousProvider);
      gateway.setActiveProvider("malicious-llm");

      await expect(
        gateway.generateSparql("Delete all people"),
      ).rejects.toThrow(/Refused: LLM generated an unsafe or non-read-only SPARQL query/);
    });

    it("STRICT VETO: Rejects queries containing smuggled DROP statements after SELECT", async () => {
      const smuggledProvider: LlmProvider = {
        id: "smuggled-llm",
        label: "Smuggled LLM",
        isConfigured: () => true,
        getModel: () => "mock-model",
        complete: async () => ({
          text: `\`\`\`sparql
SELECT * WHERE { ?s ?p ?o } ; DROP ALL
\`\`\``,
          providerId: "smuggled-llm",
          model: "mock-model",
          latencyMs: 50,
        }),
        checkHealth: async () => ({ ok: true }),
      };

      gateway.registerProvider(smuggledProvider);
      gateway.setActiveProvider("smuggled-llm");

      await expect(
        gateway.generateSparql("Show everything"),
      ).rejects.toThrow(/Refused: LLM generated an unsafe or non-read-only SPARQL query/);
    });
  });

  describe("Integration with NLQ Engine", () => {
    it("refuses unsafe user questions before touching any LLM provider", async () => {
      const res = await translate("DROP TABLE kg_nodes");
      expect(res.recognized).toBe(false);
      expect(res.refusal).toContain("read-only by design");
    });

    it("matches deterministic intents with highest priority over LLM", async () => {
      const res = await translate("spend by cost center");
      expect(res.recognized).toBe(true);
      expect(res.intent).toBe("spend-by-cost-center");
      expect(res.sparql).toContain("fin:CostCenter");
    });
  });
});
