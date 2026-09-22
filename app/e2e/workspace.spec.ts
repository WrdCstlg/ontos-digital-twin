import { test, expect } from "@playwright/test";

test.describe("Workspace & Navigation Flow", () => {
  test("allows demo persona selection and enters workspace shell", async ({ page }) => {
    await page.goto("/login");

    // Click admin persona "Elena Cortez"
    const adminPersona = page.locator("text=Elena Cortez").first();
    await expect(adminPersona).toBeVisible();
    await adminPersona.click();

    // Should redirect to /app
    await page.waitForURL("**/app**");
    await expect(page.locator("text=Acme Corp — Production").first()).toBeVisible();

    // Verify primary navigation items
    await expect(page.locator("text=Dashboard").first()).toBeVisible();
    await expect(page.locator("text=Graph Explorer").first()).toBeVisible();
    await expect(page.locator("text=Module Library").first()).toBeVisible();
  });

  test("navigates through workspace sections smoothly", async ({ page }) => {
    await page.goto("/login");
    const adminPersona = page.locator("text=Elena Cortez").first();
    await adminPersona.click();
    await page.waitForURL("**/app**");

    // Click on Module Library
    const libraryNav = page.locator("text=Module Library").first();
    await libraryNav.click();
    await page.waitForURL("**/app/library**");
    await expect(page.locator("text=Library").or(page.locator("text=Module")).first()).toBeVisible();
  });
});
