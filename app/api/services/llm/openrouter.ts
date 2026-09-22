import { env } from "../../lib/env";
import type {
  LlmCompletionOptions,
  LlmCompletionResult,
  LlmHealthStatus,
  LlmProvider,
} from "./types";

export class OpenRouterProvider implements LlmProvider {
  readonly id = "openrouter";
  readonly label = "OpenRouter";

  private apiKey?: string;
  private model: string;
  private endpoint: string;

  constructor(apiKey?: string, model?: string, endpoint?: string) {
    this.apiKey = apiKey || env.openrouterApiKey || undefined;
    this.model = model || env.openrouterModel || "";
    this.endpoint = endpoint || "https://openrouter.ai/api/v1";
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
      throw new Error("OpenRouter provider is not configured with an API key.");
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
          "HTTP-Referer": "https://ontos.enterprise",
          "X-Title": "Ontos Digital Twin",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model || undefined,
          messages,
          temperature: options.temperature ?? 0.1,
          max_tokens: options.maxTokens ?? 512,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`OpenRouter error (${res.status}): ${errText || res.statusText}`);
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
