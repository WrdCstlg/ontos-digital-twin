/**
 * LLM provider configurations for the Ontos AI gateway.
 * Demo build: translation/narratives are deterministic and simulated for
 * offline reliability; the provider interface and guardrails are real.
 */
export type LlmProviderConfig = {
  id: string;
  label: string;
  status: "active" | "configured" | "unconfigured";
  model?: string;
  endpoint?: string;
  maskedKey?: string;
  latencyP50Ms?: number;
  note?: string;
};

export const LLM_PROVIDERS: LlmProviderConfig[] = [
  {
    id: "ollama",
    label: "Ollama (local)",
    status: "active",
    model: "llama3.1",
    endpoint: "http://ollama:11434",
    latencyP50Ms: 210,
    note: "Default for offline demo — zero data leaves the cluster.",
  },
  {
    id: "openai",
    label: "OpenAI",
    status: "unconfigured",
    model: "gpt-4o",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    status: "unconfigured",
    model: "claude-sonnet-4",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    status: "unconfigured",
  },
];
