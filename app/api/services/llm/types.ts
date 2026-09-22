export interface LlmCompletionOptions {
  systemPrompt?: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface LlmCompletionResult {
  text: string;
  providerId: string;
  model: string;
  latencyMs: number;
}

export interface LlmHealthStatus {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export interface LlmProvider {
  readonly id: string;
  readonly label: string;
  isConfigured(): boolean;
  getModel(): string;
  complete(options: LlmCompletionOptions): Promise<LlmCompletionResult>;
  checkHealth(): Promise<LlmHealthStatus>;
  getMaskedKey?(): string | undefined;
  getEndpoint?(): string | undefined;
}
