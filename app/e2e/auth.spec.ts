import { expect, PERSONAS, signInAs, test } from "./support";

test.describe("Landing page and sign-in", () => {
  test("the landing page introduces Ontos and leads to sign-in", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Ontos/);
    await expect(page.getByRole("link", { name: "Ontos home" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
      "Your enterprise already has the data. Ontos gives it meaning."
    );
    await expect(
      page.getByRole("link", { name: "Launch the Acme Demo" })
    ).toHaveAttribute("href", "/app");

    await page
      .getByRole("banner")
      .getByRole("link", { name: "Sign in", exact: true })
      .click();
    await expect(page).toHaveURL("/login");
    await expect(page.getByText("Select a Persona")).toBeVisible();
  });

  test("the login page offers the four personas and a credential form", async ({
    page,
  }) => {
    await page.goto("/login");
    for (const { name } of Object.values(PERSONAS)) {
      await expect(page.getByRole("button", { name })).toBeEnabled();
    }
    const submit = page.getByRole("button", { name: "Sign In", exact: true });
    await expect(submit).toBeDisabled();

    // An address of its own, so the per-address sign-in limit never builds up
    // across runs against the same stack.
    await page.getByLabel("Email").fill(`e2e-${Date.now()}@example.com`);
    await page.getByLabel("Password").fill("not-the-password");
    await submit.click();
    await expect(page.getByRole("alert")).toHaveText(
      "Invalid email or password."
    );
    await expect(page).toHaveURL("/login");
  });

  test("a signed-out visit to a workspace page asks for sign-in, then returns there", async ({
    page,
  }) => {
    await page.goto("/app/insights");
    await expect(page).toHaveURL("/login");
    await signInAs(page, "viewer");
    await expect(page).toHaveURL("/app/insights");
    await expect(
      page.getByRole("heading", { level: 1, name: "Insights" })
    ).toBeVisible();
  });
});
