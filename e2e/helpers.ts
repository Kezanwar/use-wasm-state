import { expect, type Page } from "@playwright/test";

/** The two engines the grid can run on. */
export const MODES = ["sync", "worker"] as const;
export type Mode = (typeof MODES)[number];

/**
 * The production build, served the way Pages serves it.
 *
 * Frame budgets are measured here, not against the dev server: React's
 * development build carries checks that production does not, and a budget
 * set against it would be measuring the wrong thing.
 */
export const PROD = "http://localhost:4178/use-wasm-state/";

/** Every route, relative to the basename, with something only that page shows. */
export const ROUTES = [
  ["", "What it is"],
  ["datagrid/start", "Install"],
  ["datagrid/examples", "Basic"],
  ["datagrid/benchmarks", "Frames"],
  ["datagrid/api", "Hooks"],
] as const;

/**
 * Open the Examples page with the grid loaded in a given mode.
 *
 * Worker mode is reached through the toolbar switch rather than a URL, so
 * the test exercises the same path a visitor does.
 */
export async function ready(page: Page, mode: Mode = "sync", base = "") {
  await page.goto(`${base}datagrid/examples`);
  await expect(page.getByTestId("row-count")).toHaveText("200,000", { timeout: 60_000 });

  if (mode === "worker") {
    await page.getByTestId("mode-worker").click();
    await expect(page.getByTestId("mode-worker")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("row-count")).toHaveText("200,000", { timeout: 60_000 });
  }
}

export const rowCount = (page: Page) =>
  page
    .getByTestId("row-count")
    .textContent()
    .then((text) => Number((text ?? "0").replace(/\D/g, "")));

/** A cell by its offset in the rendered rows and its column index. */
export const cell = (page: Page, row: number, column: number) =>
  page.locator(`[data-row="${row}"] [role="gridcell"]`).nth(column);
