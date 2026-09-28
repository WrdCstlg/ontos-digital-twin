/**
 * What a page offers each role, as the server's `capabilities` answer for the
 * member's workspace role decides. These tests only look: nothing they do
 * changes data another test can see.
 */
import type { Page } from "@playwright/test";
import { capabilities, expect, openAs, test } from "./support";

test.describe("Twin simulation", () => {
  test("a viewer watches the simulation but cannot run it", async ({
    page,
  }) => {
    const verdict = capabilities(page, "twin.capabilities");
    await openAs(page, "viewer", "/app/twins");
    expect(await verdict).toEqual({ canSimulate: false });

    const tick = page.getByRole("button", { name: "Tick", exact: true });
    await expect(tick).toBeDisabled();
    await expect(tick).toHaveAccessibleDescription(
      /takes the editor role or above/
    );
    await expect(
      page.getByRole("switch", { name: "Auto-tick every 2 seconds" })
    ).toBeDisabled();
  });

  test("an editor can run the simulation", async ({ page }) => {
    const verdict = capabilities(page, "twin.capabilities");
    await openAs(page, "editor", "/app/twins");
    expect(await verdict).toEqual({ canSimulate: true });

    await expect(
      page.getByRole("button", { name: "Tick", exact: true })
    ).toBeEnabled();
    await expect(
      page.getByRole("switch", { name: "Auto-tick every 2 seconds" })
    ).toBeEnabled();
  });
});

test.describe("IoT brokers", () => {
  /** Opens the IoT dialog on the Twins page, with the server's answer to what the role may do there. */
  async function openBrokers(page: Page) {
    const verdict = capabilities(page, "iot.capabilities");
    await page.getByRole("button", { name: "IoT Brokers" }).click();
    const dialog = page.getByRole("dialog", {
      name: "IoT Telemetry Brokers & Ingestion",
    });
    await expect(dialog).toBeVisible();
    return { dialog, verdict: await verdict };
  }

  test("a viewer cannot add or manage a broker, and sees no login fields", async ({
    page,
  }) => {
    await openAs(page, "viewer", "/app/twins");
    const { dialog, verdict } = await openBrokers(page);
    expect(verdict).toEqual({ canManageBrokers: false, canIngest: false });

    await expect(
      dialog.getByText("Brokers are managed by workspace admins.")
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Add Broker" })
    ).toHaveCount(0);
    // Nor on any broker already there: the seed has none, a stack may.
    await expect(
      dialog.getByRole("button", { name: /^(Connect|Disconnect|Delete) / })
    ).toHaveCount(0);
    await expect(dialog.getByLabel("Username")).toHaveCount(0);
    await expect(dialog.getByLabel("Password")).toHaveCount(0);

    // Sending telemetry writes twin state, which is not a viewer's to do either.
    await dialog.getByRole("tab", { name: "Test Sandbox" }).click();
    await expect(
      dialog.getByRole("button", { name: "Send Test Ingest" })
    ).toBeDisabled();
  });

  test("an admin can add a broker, with its login fields", async ({ page }) => {
    await openAs(page, "admin", "/app/twins");
    const { dialog, verdict } = await openBrokers(page);
    expect(verdict).toEqual({ canManageBrokers: true, canIngest: true });

    await dialog.getByRole("button", { name: "Add Broker" }).click();
    await expect(dialog.getByLabel("Broker Name")).toBeVisible();
    await expect(dialog.getByLabel("Endpoint URL")).toBeVisible();
    await dialog.getByLabel("Authentication Type").selectOption("basic");
    await expect(dialog.getByLabel("Username")).toBeVisible();
    await expect(dialog.getByLabel("Password")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Save & Connect" })
    ).toBeEnabled();

    // Put the form away unsaved: no broker is created.
    await dialog.getByRole("button", { name: "Cancel" }).first().click();
    await expect(dialog.getByLabel("Broker Name")).toHaveCount(0);
  });
});

test.describe("Insights", () => {
  /** The whole feed, however long ago the stack was seeded: it opens on the last 30 days. */
  async function allFindings(page: Page) {
    await page.getByRole("combobox", { name: "Date range" }).click();
    await page.getByRole("option", { name: "all time" }).click();
    const feed = page.getByRole("region", { name: "Insight feed" });
    await expect(feed.getByRole("article").first()).toBeVisible();
    return feed;
  }

  test("a viewer can read and trace a finding but not acknowledge it", async ({
    page,
  }) => {
    const verdict = capabilities(page, "insights.capabilities");
    await openAs(page, "viewer", "/app/insights");
    expect(await verdict).toEqual({ canAcknowledge: false });

    const feed = await allFindings(page);
    await expect(feed.getByRole("button", { name: "Acknowledge" })).toHaveCount(
      0
    );

    const open = feed
      .getByRole("article")
      .filter({ hasNotText: "ACKNOWLEDGED" })
      .first();
    await open.getByRole("button", { name: "Trace evidence" }).click();
    const trace = page.getByRole("dialog");
    await expect(
      trace.getByRole("button", { name: "Share link" })
    ).toBeVisible();
    await expect(
      trace.getByRole("button", { name: "Mark resolved" })
    ).toHaveCount(0);
  });

  test("an editor is offered acknowledging an open finding", async ({
    page,
  }) => {
    const verdict = capabilities(page, "insights.capabilities");
    await openAs(page, "editor", "/app/insights");
    expect(await verdict).toEqual({ canAcknowledge: true });

    // Offered, not taken: acknowledging cannot be undone once it is sent.
    const feed = await allFindings(page);
    const acknowledge = page.getByRole("button", { name: "Acknowledge" });
    const open = feed.getByRole("article").filter({ has: acknowledge }).first();
    await expect(
      open.getByRole("button", { name: "Acknowledge" })
    ).toBeEnabled();

    await open.getByRole("button", { name: "Trace evidence" }).click();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "Mark resolved" })
    ).toBeEnabled();
  });
});
