import { expect, test } from "@playwright/test";

/** The two smaller examples, each exercised once. */

test.beforeEach(async ({ page }) => {
  await page.goto("/#examples");
});

test("the basic example adds and edits a row", async ({ page }) => {
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

test("editing one window updates the other's stats", async ({ page }) => {
  const stats = page.getByTestId("two-views-stats");
  await expect(stats).toContainText("40 rows");
  const before = await stats.textContent();

  // Both windows read the same table, so an edit in one is a revision
  // bump both of them see.
  const input = page.getByTestId("window-top").locator("input").first();
  await input.fill("edited");
  await expect(input).toHaveValue("edited");
  await expect(stats).not.toHaveText(before!);

  await expect(page.getByTestId("window-bottom")).toContainText("view(20, 5)");
});
