import { defineConfig } from "vitest/config";
import path from "path";
import { TEST_DATABASE } from "./api/__tests__/mysql/database";

/**
 * Server tests on a real MySQL (npm run test:mysql). They cover what the
 * in-memory database only imitates: migrations, row locks in the job queue,
 * and workspace scoping in real SQL. ONTOS_TEST_DATABASE_URL names a MySQL 8.4
 * server (no database) on which the tests may create and drop ontos_test.
 */
const templateRoot = path.resolve(import.meta.dirname);
const server = process.env.ONTOS_TEST_DATABASE_URL?.replace(/\/$/, "");

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "src"),
      "@contracts": path.resolve(templateRoot, "contracts"),
      "@db": path.resolve(templateRoot, "db"),
    },
  },
  test: {
    environment: "node",
    include: ["api/**/*.mysql.test.ts"],
    globalSetup: ["api/__tests__/mysql/globalSetup.ts"],
    // One database, shared: files run one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: server ? { DATABASE_URL: `${server}/${TEST_DATABASE}` } : {},
  },
});
