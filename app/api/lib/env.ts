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
};
