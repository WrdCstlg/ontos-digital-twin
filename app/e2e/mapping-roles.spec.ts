/**
 * A mapping set to block keeps rows that break its class's SHACL shapes out,
 * and only ontologists and admins may switch that off. The seed sets no
 * mapping to block, so the test has an ontologist set one, through the editor,
 * and switch it back at the end. The mapping is the seed's ERP one: a draft on
 * a REST connector, which nothing imports.
 *
 * The change is visible to every test, so this one is tagged @shared-state and
 * runs alone (playwright.config.ts): two runs of it never overlap.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./support";

const MAPPING = "erp-invoices → fin:Invoice";

/** Opens the mapping in the editor, and returns its SHACL toggle. */
async function openMapping(page: Page) {
  await page.getByRole("button", { name: MAPPING, exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Mapping name" })).toHaveValue(
    MAPPING
  );
  return page.getByRole("checkbox", { name: "Block imports that fail SHACL" });
}

async function save(page: Page) {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Mapping saved")).toBeVisible();
}

test.describe("Mapping SHACL check", { tag: "@shared-state" }, () => {
  test("a blocking check is locked for an editor and free for an ontologist", async ({
    persona,
  }) => {
    const ontologist = await persona("ontologist", "/app/mapping");
    let toggle = await openMapping(ontologist);
    await expect(toggle).toBeEnabled();
    // A run that failed part-way may have left it blocking already.
    if (!(await toggle.isChecked())) {
      await toggle.check();
      await save(ontologist);
    }

    const editor = await persona("editor", "/app/mapping");
    const locked = await openMapping(editor);
    // The reason shows once the page knows the editor may not relax the check.
    await expect(
      editor.getByTitle(
        /Only ontologists and admins can switch it back to warn/
      )
    ).toBeVisible();
    await expect(locked).toBeChecked();
    await expect(locked).toBeDisabled();

    // Loaded afresh, the ontologist is free to switch it off, and doing so puts
    // the mapping back as the seed left it.
    await ontologist.reload();
    toggle = await openMapping(ontologist);
    await expect(toggle).toBeChecked();
    await expect(toggle).toBeEnabled();
    await toggle.uncheck();
    await save(ontologist);
  });

  test.afterEach(async ({ persona }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    // Failed with the mapping perhaps still blocking: put it back to warn.
    const ontologist = await persona("ontologist", "/app/mapping");
    const toggle = await openMapping(ontologist);
    await expect(toggle).toBeEnabled();
    if (await toggle.isChecked()) {
      await toggle.uncheck();
      await save(ontologist);
    }
  });
});
