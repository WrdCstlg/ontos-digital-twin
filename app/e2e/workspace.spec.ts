import { expect, PERSONAS, type Role, signInAs, test } from "./support";

test.describe("Workspace shell", () => {
  for (const role of ["admin", "ontologist", "editor", "viewer"] as Role[]) {
    const persona = PERSONAS[role];

    test(`${persona.name} signs in to the ${persona.page} page as ${role}`, async ({
      page,
    }) => {
      await page.goto("/login");
      await signInAs(page, role);
      await expect(page).toHaveURL(persona.home);
      await expect(
        page.getByRole("navigation", { name: "Breadcrumb" })
      ).toContainText(persona.page);

      const sidebar = page.getByRole("complementary", { name: "Sidebar" });
      await expect(sidebar.getByText("Acme Corp — Production")).toBeVisible();
      await expect(sidebar).toContainText(persona.name);
      // The chip under the name shows the role in this workspace; an admin's
      // shares its word with the Admin item above it, so take the last.
      await expect(
        sidebar.getByText(persona.chip, { exact: true }).last()
      ).toBeVisible();

      // Admin follows the workspace role. The chip is in, so the role is known.
      const admin = sidebar
        .getByRole("navigation", { name: "App navigation" })
        .getByRole("link", { name: "Admin", exact: true });
      if (role === "admin") await expect(admin).toBeVisible();
      else await expect(admin).toHaveCount(0);
    });
  }

  test("the sidebar moves between the workspace's sections", async ({
    page,
  }) => {
    await page.goto("/login");
    await signInAs(page, "admin");
    await expect(page).toHaveURL("/app");

    const nav = page.getByRole("navigation", { name: "App navigation" });
    const crumb = page.getByRole("navigation", { name: "Breadcrumb" });
    const sections = [
      {
        link: "Module Library",
        path: "/app/library",
        heading: "Module Library",
      },
      { link: "Twin Explorer", path: "/app/twins", heading: "Twin Explorer" },
      { link: "Insights", path: "/app/insights", heading: "Insights" },
      { link: "Dashboard", path: "/app", heading: /Elena/ },
    ];
    for (const { link, path, heading } of sections) {
      await nav.getByRole("link", { name: link, exact: true }).click();
      await expect(page).toHaveURL(path);
      await expect(
        page.getByRole("heading", { level: 1, name: heading })
      ).toBeVisible();
      await expect(crumb).toContainText(link);
      await expect(
        nav.getByRole("link", { name: link, exact: true })
      ).toHaveAttribute("aria-current", "page");
    }
  });
});
