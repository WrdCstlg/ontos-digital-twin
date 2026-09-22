import { env } from "../../lib/env";
import type {
  LlmCompletionOptions,
  LlmCompletionResult,
  LlmHealthStatus,
  LlmProvider,
} from "./types";

export class OllamaProvider implements LlmProvider {
  readonly id = "ollama";
  readonly label = "Ollama (local)";

  private endpoint: string;
  private model: string;

  constructor(endpoint?: string, model?: string) {
    this.endpoint = (endpoint || env.ollamaUrl || "http://localhost:11434").replace(/\/+$/, "");
    // Preserve exact existing default if not specified
    this.model = model || env.ollamaModel || "llama3.1";
  }

  isConfigured(): boolean {
    return Boolean(this.endpoint);
  }

  getModel(): string {
    return this.model;
  }

  getEndpoint(): string {
    return this.endpoint;
  }

  async checkHealth(): Promise<LlmHealthStatus> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${this.endpoint}/api/version`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        return { ok: true, latencyMs: Date.now() - start };
      }
      return { ok: false, error: `HTTP ${res.status}` };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Connection failed",
      };
    }
  }

  async complete(options: LlmCompletionOptions): Promise<LlmCompletionResult> {
    const start = Date.now();
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 15_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.endpoint}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          prompt: options.prompt,
          system: options.systemPrompt,
          stream: false,
          options: {
            temperature: options.temperature ?? 0.1,
            num_predict: options.maxTokens ?? 512,
          },
        }),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        throw new Error(`Ollama error (${res.status}): ${errorText || res.statusText}`);
      }

      const data = (await res.json()) as { response?: string };
      return {
        text: data.response ?? "",
        providerId: this.id,
        model: this.model,
        latencyMs: Date.now() - start,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
