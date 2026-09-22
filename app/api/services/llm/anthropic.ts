import { env } from "../../lib/env";
import type {
  LlmCompletionOptions,
  LlmCompletionResult,
  LlmHealthStatus,
  LlmProvider,
} from "./types";

export class AnthropicProvider implements LlmProvider {
  readonly id = "anthropic";
  readonly label = "Anthropic";

  private apiKey?: string;
  private model: string;
  private endpoint: string;

  constructor(apiKey?: string, model?: string, endpoint?: string) {
    this.apiKey = apiKey || env.anthropicApiKey || undefined;
    // Preserve exact existing default if not specified
    this.model = model || env.anthropicModel || "claude-sonnet-4";
    this.endpoint = endpoint || "https://api.anthropic.com/v1";
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  getModel(): string {
    return this.model;
  }

  getEndpoint(): string {
    return this.endpoint;
  }

  getMaskedKey(): string | undefined {
    if (!this.apiKey) return undefined;
    const len = this.apiKey.length;
    if (len <= 8) return "••••••••";
    return `${this.apiKey.slice(0, 7)}...${this.apiKey.slice(-4)}`;
  }

  async checkHealth(): Promise<LlmHealthStatus> {
    if (!this.isConfigured()) {
      return { ok: false, error: "API key not configured" };
    }
    return { ok: true, latencyMs: 0 };
  }

  async complete(options: LlmCompletionOptions): Promise<LlmCompletionResult> {
    if (!this.isConfigured()) {
      throw new Error("Anthropic provider is not configured with an API key.");
    }

    const start = Date.now();
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 15_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.endpoint}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey!,
          "anthropic-version": "2023-06-01",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          system: options.systemPrompt,
          messages: [{ role: "user", content: options.prompt }],
          max_tokens: options.maxTokens ?? 512,
          temperature: options.temperature ?? 0.1,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Anthropic error (${res.status}): ${errText || res.statusText}`);
      }

      const data = (await res.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = data.content?.find((c) => c.type === "text")?.text ?? "";

      return {
        text,
        providerId: this.id,
        model: this.model,
        latencyMs: Date.now() - start,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
