import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

export const env = {
  appId: process.env.APP_ID || "ontos",
  appSecret:
    process.env.APP_SECRET ||
    (process.env.NODE_ENV === "production"
      ? required("APP_SECRET")
      : "ontos-development-jwt-signing-secret-key-32b!"),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  adminEmail: process.env.ADMIN_EMAIL ?? "admin@acme-ontology.com",
  /**
   * Re-enables one-click persona login in production. Anyone who can reach the
   * server can then sign in as any role, admin included — local demos only.
   */
  allowDemoLogin: process.env.ALLOW_DEMO_LOGIN === "true",

  // Pluggable LLM Gateway configuration (Local + Cloud)
  ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL,
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicModel: process.env.ANTHROPIC_MODEL,
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  openrouterModel: process.env.OPENROUTER_MODEL,
};

