import { expect, test, type Page } from "@playwright/test";
import { MODES, type Mode } from "./helpers";

/** The two smaller examples, each exercised in both modes. */

async function open(page: Page, mode: Mode) {
  await page.goto("/#examples");
  if (mode === "worker") {
    await page.getByTestId("mode-worker").click();
    await expect(page.getByTestId("mode-worker")).toHaveAttribute("aria-pressed", "true");
  }
}

for (const mode of MODES) {
  test(`${mode}: the basic example adds, edits and deletes a row`, async ({ page }) => {
    await open(page, mode);
    const table = page.getByTestId("basic-table");
    await expect(table.locator("tbody tr")).toHaveCount(3);

    await page.getByTestId("basic-add").click();
    await expect(table.locator("tbody tr")).toHaveCount(4);

    const name = table.locator("tbody tr").last().locator("input").first();
    await name.fill("Mousepad");
    await expect(name).toHaveValue("Mousepad");

    await table.locator("tbody tr").last().getByRole("button").click();
    await expect(table.locator("tbody tr")).toHaveCount(3);
  });

  test(`${mode}: the shared grid outlives the component showing it`, async ({ page }) => {
    await open(page, mode);
    const summary = page.getByTestId("shared-summary");
    const list = page.getByTestId("shared-list");
    const add = async (item: string) => {
      await page.getByTestId("shared-input").fill(item);
      await page.getByTestId("shared-add").click();
    };

    await expect(summary).toHaveText("3 items");
    await add("Mousepad");
    // The editor added it; the summary and the list are other components
    // naming the same grid.
    await expect(summary).toHaveText("4 items");
    await expect(list).toContainText("Mousepad");

    // Unmount the list, and keep editing while nothing shows the rows.
    await page.getByTestId("shared-toggle").click();
    await expect(list).toHaveCount(0);
    await add("Lamp");
    await expect(summary).toHaveText("5 items");

    // Back, with everything it missed.
    await page.getByTestId("shared-toggle").click();
    await expect(list).toContainText("Mousepad");
    await expect(list).toContainText("Lamp");
    await expect(list.locator("li")).toHaveCount(5);

    await page.getByTestId("shared-sort").click();
    await expect(summary).toHaveText("5 items · item ↑");
    await expect(list.locator("li").first()).toContainText("Cable");
  });
}
