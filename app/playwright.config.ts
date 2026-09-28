import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests against a running stack with persona login on
 * (ALLOW_DEMO_LOGIN=true). BASE_URL points at it; README.md, Testing.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // CI keeps an HTML report, uploaded when the job fails.
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      grepInvert: /@shared-state/,
    },
    {
      // Tests that change data other tests can see, and put it back. They run
      // one at a time, so two runs of one never overlap, under --repeat-each
      // as under retries.
      name: "chromium-shared-state",
      use: { ...devices["Desktop Chrome"] },
      grep: /@shared-state/,
      workers: 1,
    },
  ],
});
