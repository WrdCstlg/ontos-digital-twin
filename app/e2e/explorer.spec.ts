import { expect, openAs, test } from "./support";

const QUESTION = "Which vendors have payments but no active contract?";

test.describe("Graph explorer", () => {
  test.beforeEach(async ({ page }) => {
    await openAs(page, "viewer", "/app/explorer");
  });

  test("draws the graph with its search, depth and layout controls", async ({
    page,
  }) => {
    // The zoom controls belong to the canvas, which draws once the graph loads.
    const fit = page.getByRole("button", { name: "Fit graph" });
    await expect(fit).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Search nodes…" })
    ).toBeVisible();
    for (const name of [
      "depth 1",
      "depth 2",
      "force",
      "radial",
      "hierarchy",
      "timeline",
    ]) {
      await expect(
        page.getByRole("button", { name, exact: true })
      ).toBeVisible();
    }

    await page.getByRole("button", { name: "hierarchy", exact: true }).click();
    await page.getByRole("button", { name: "depth 1", exact: true }).click();
    await expect(fit).toBeVisible();
  });

  test("search finds a node and centres the graph on it", async ({ page }) => {
    const search = page.getByRole("textbox", { name: "Search nodes…" });
    await search.fill("Acme Corp");
    await page.getByRole("button", { name: "Acme Corp hr:OrgUnit" }).click();
    await expect(search).toHaveValue("");
    await expect(page.getByRole("button", { name: "Fit graph" })).toBeVisible();
  });

  test("answers a sample question with a read-only query and its rows", async ({
    page,
  }) => {
    const ask = page.getByRole("button", { name: /^Ask/ });
    await expect(ask).toBeDisabled();

    await page.getByRole("button", { name: QUESTION, exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Ask a question in natural language" })
    ).toHaveValue(QUESTION);
    await ask.click();

    // The question becomes a read-only query, whose rows name vendors.
    await expect(
      page.getByRole("textbox", { name: "Generated query editor" })
    ).toHaveValue(/intent:vendors-with-payments-no-contract/, {
      timeout: 15_000,
    });
    await expect(
      page
        .getByRole("table")
        .getByRole("button", { name: /^fin:Vendor\// })
        .first()
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: "clear answer · back to browse" })
    ).toBeVisible();
  });
});
