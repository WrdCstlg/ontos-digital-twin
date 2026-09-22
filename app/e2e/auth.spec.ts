import { test, expect } from "@playwright/test";

test.describe("Authentication & Landing Flow", () => {
  test("renders landing page with platform title and brand", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/ontos/i);
    const brand = page.locator("text=ontos").first();
    await expect(brand).toBeVisible();
  });

  test("landing page displays semantic layer description", async ({ page }) => {
    await page.goto("/");
    const description = page.locator("text=semantic layer of the enterprise").first();
    await expect(description).toBeVisible();
  });
});
