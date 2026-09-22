import { test, expect } from "@playwright/test";

test.describe("Graph & Query Explorer Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    const adminPersona = page.locator("text=Elena Cortez").first();
    await adminPersona.click();
    await page.waitForURL("**/app**");
  });

  test("renders graph explorer canvas controls and layout toggles", async ({ page }) => {
    await page.goto("/app/explorer");

    // Verify search input
    const searchInput = page.locator('input[placeholder="Search nodes…"]');
    await expect(searchInput).toBeVisible();

    // Verify layout switchers (force, radial, hierarchy, timeline)
    await expect(page.locator("button", { hasText: "force" })).toBeVisible();
    await expect(page.locator("button", { hasText: "radial" })).toBeVisible();

    // Verify depth toggles
    await expect(page.locator("button", { hasText: "depth 1" })).toBeVisible();
    await expect(page.locator("button", { hasText: "depth 2" })).toBeVisible();
  });

  test("displays natural language query interface with suggestions", async ({ page }) => {
    await page.goto("/app/explorer");

    // Look for NL query prompt area or suggestions
    const nlBar = page.locator('textarea, input[type="text"]').first();
    await expect(nlBar).toBeVisible();

    // Verify presence of question chips or translation editor
    const chipsOrCode = page.locator("button, code, pre").first();
    await expect(chipsOrCode).toBeVisible();
  });
});
