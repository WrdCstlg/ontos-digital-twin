import { env } from "../../lib/env";
import type {
  LlmCompletionOptions,
  LlmCompletionResult,
  LlmHealthStatus,
  LlmProvider,
} from "./types";

export class OpenAiProvider implements LlmProvider {
  readonly id = "openai";
  readonly label = "OpenAI";

  private apiKey?: string;
  private model: string;
  private endpoint: string;

  constructor(apiKey?: string, model?: string, endpoint?: string) {
    this.apiKey = apiKey || env.openaiApiKey || undefined;
    // Preserve exact existing default if not specified
    this.model = model || env.openaiModel || "gpt-4o";
    this.endpoint = endpoint || "https://api.openai.com/v1";
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
    return `${this.apiKey.slice(0, 3)}...${this.apiKey.slice(-4)}`;
  }

  async checkHealth(): Promise<LlmHealthStatus> {
    if (!this.isConfigured()) {
      return { ok: false, error: "API key not configured" };
    }
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${this.endpoint}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
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
    if (!this.isConfigured()) {
      throw new Error("OpenAI provider is not configured with an API key.");
    }

    const start = Date.now();
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 15_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: options.prompt });

    try {
      const res = await fetch(`${this.endpoint}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: options.temperature ?? 0.1,
          max_tokens: options.maxTokens ?? 512,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`OpenAI error (${res.status}): ${errText || res.statusText}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content ?? "";

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
