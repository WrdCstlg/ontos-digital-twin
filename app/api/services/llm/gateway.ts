import type { LlmProviderConfig } from "@contracts/providers";
import { isReadOnlySparql } from "../../lib/sparqlGuard";
import type { LlmProvider } from "./types";
import { OllamaProvider } from "./ollama";
import { OpenAiProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";
import { OpenRouterProvider } from "./openrouter";

export class LlmGateway {
  private providers: Map<string, LlmProvider> = new Map();
  private activeProviderId: string | null = null;

  constructor() {
    this.registerProvider(new OllamaProvider());
    this.registerProvider(new OpenAiProvider());
    this.registerProvider(new AnthropicProvider());
    this.registerProvider(new OpenRouterProvider());
  }

  registerProvider(provider: LlmProvider) {
    this.providers.set(provider.id, provider);
  }

  getProvider(id: string): LlmProvider | undefined {
    return this.providers.get(id);
  }

  setActiveProvider(id: string) {
    if (!this.providers.has(id)) {
      throw new Error(`Unknown LLM provider: ${id}`);
    }
    this.activeProviderId = id;
  }

  getActiveProvider(): LlmProvider | null {
    if (this.activeProviderId && this.providers.has(this.activeProviderId)) {
      return this.providers.get(this.activeProviderId)!;
    }
    // Default priority: active provider if explicitly set, else first configured cloud or local ollama
    for (const p of this.providers.values()) {
      if (p.isConfigured()) return p;
    }
    return null;
  }

  async getProviderStatuses(): Promise<LlmProviderConfig[]> {
    const active = this.getActiveProvider();
    const result: LlmProviderConfig[] = [];

    for (const [id, provider] of this.providers.entries()) {
      const isConfigured = provider.isConfigured();
      const isActive = active?.id === id;
      const status: "active" | "configured" | "unconfigured" = isActive
        ? "active"
        : isConfigured
          ? "configured"
          : "unconfigured";

      let latencyP50Ms: number | undefined;
      if (isConfigured) {
        try {
          const health = await provider.checkHealth();
          if (health.ok && health.latencyMs !== undefined) {
            latencyP50Ms = Math.max(10, Math.round(health.latencyMs));
          }
        } catch {
          // ignore error for status list
        }
      }

      result.push({
        id,
        label: provider.label,
        status,
        model: provider.getModel(),
        endpoint: provider.getEndpoint?.(),
        maskedKey: provider.getMaskedKey?.(),
        latencyP50Ms: latencyP50Ms ?? (id === "ollama" ? 210 : undefined),
        note:
          id === "ollama"
            ? "Default for offline demo — zero data leaves the cluster."
            : undefined,
      });
    }

    return result;
  }

  async generateSparql(
    question: string,
    ontologyContext?: string,
  ): Promise<{
    sparql: string;
    explanation: string;
    providerId: string;
    model: string;
  } | null> {
    const provider = this.getActiveProvider();
    if (!provider || !provider.isConfigured()) {
      return null;
    }

    const systemPrompt = `You are a SPARQL query generator for an enterprise knowledge graph ontology (Ontos).
The knowledge graph uses standard prefixes:
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX hr: <https://ontos.enterprise/schema/hr#>
PREFIX lgl: <https://ontos.enterprise/schema/legal#>
PREFIX cmp: <https://ontos.enterprise/schema/compliance#>
PREFIX fin: <https://ontos.enterprise/schema/finance#>
PREFIX log: <https://ontos.enterprise/schema/logistics#>
PREFIX twin: <https://ontos.enterprise/schema/twin#>

CRITICAL SECURITY CONSTRAINT:
- ONLY generate read-only SPARQL 1.1 SELECT queries.
- NEVER generate INSERT, DELETE, DROP, CLEAR, LOAD, CREATE, COPY, MOVE, or ADD statements.
- Any write query will be automatically rejected by the read-only AST guardrail.

Format your response exactly as:
\`\`\`sparql
SELECT ...
WHERE {
  ...
}
\`\`\`
Explanation: <1-2 sentence plain English explanation of what this query retrieves>`;

    const prompt = `Question: "${question}"\n${ontologyContext ? `Ontology Context:\n${ontologyContext}\n` : ""}\nGenerate the read-only SPARQL 1.1 SELECT query:`;

    const res = await provider.complete({
      systemPrompt,
      prompt,
      temperature: 0.1,
      maxTokens: 512,
      timeoutMs: 10_000,
    });

    const text = res.text.trim();

    // Extract SPARQL block
    let sparql: string | null = null;
    const codeBlockMatch = text.match(/```(?:sparql)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch) {
      sparql = codeBlockMatch[1].trim();
    } else {
      const selectMatch = text.match(/\bSELECT\b[\s\S]+/i);
      if (selectMatch) {
        sparql = selectMatch[0].trim();
      }
    }

    if (!sparql) {
      throw new Error("Failed to extract valid SPARQL query from model response.");
    }

    // Extract explanation
    let explanation = "Generated SPARQL query based on ontology context.";
    const explainMatch = text.match(/Explanation:\s*(.+)$/im);
    if (explainMatch) {
      explanation = explainMatch[1].trim();
    }

    // MANDATORY SECURITY GUARD: Read-only validation
    if (!isReadOnlySparql(sparql)) {
      throw new Error("Refused: LLM generated an unsafe or non-read-only SPARQL query.");
    }

    return {
      sparql,
      explanation,
      providerId: res.providerId,
      model: res.model,
    };
  }
}

export const llmGateway = new LlmGateway();
