import { expect, test, type Page } from "@playwright/test";

/**
 * The browser is the only place the real thing runs: 200k rows in wasm,
 * a virtualised grid, and a scroll that has to hold its frame rate. None
 * of that is observable in jsdom.
 */

const ROWS = 200_000;

/** The grid renders once the engine has loaded and the rows are in. */
async function ready(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("row-count")).toHaveText("200,000", { timeout: 60_000 });
}

const rowCount = (page: Page) =>
  page
    .getByTestId("row-count")
    .textContent()
    .then((text) => Number((text ?? "0").replace(/\D/g, "")));

const cell = (page: Page, row: number, column: number) =>
  page.locator(`[data-row="${row}"] [role="gridcell"]`).nth(column);

test("loads 200,000 rows", async ({ page }) => {
  await ready(page);

  await expect(page.getByTestId("revision")).toHaveText("r1");
  // Only the visible slice exists in the DOM; the rest is scroll height.
  const rendered = await page.locator('[role="row"]').count();
  expect(rendered).toBeGreaterThan(0);
  expect(rendered).toBeLessThan(200);
});

test("scrolls to the bottom and renders the last row", async ({ page }) => {
  await ready(page);

  const grid = page.getByTestId("grid");
  await grid.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  const last = page.locator(`[data-row="${ROWS - 1}"]`);
  await expect(last).toBeVisible();
  // ids are 1-based in the generator, so the last row shows 200000.
  await expect(last.locator('[role="gridcell"]').first()).toHaveText("200000");
});

test("edits a price, and the cell and revision update", async ({ page }) => {
  await ready(page);

  const price = cell(page, 0, 5);
  const before = await price.textContent();

  await price.dblclick();
  const editor = page.getByTestId("cell-editor");
  await editor.fill("1234.56");
  await editor.press("Enter");

  await expect(price).toHaveText("$1,234.56");
  expect(await price.textContent()).not.toBe(before);
  await expect(page.getByTestId("revision")).toHaveText("r2");
  // The status bar shows what that edit cost.
  await expect(page.getByTestId("last-ms")).not.toBeEmpty();
});

test("a new string survives scrolling away and back", async ({ page }) => {
  await ready(page);

  // A value the column has never held, so the engine appends a dictionary
  // entry and the JS mirror has to pick it up.
  const customer = cell(page, 0, 1);
  await customer.dblclick();
  const editor = page.getByTestId("cell-editor");
  await editor.fill("Zzyzx Placeholder");
  await editor.press("Enter");
  await expect(customer).toHaveText("Zzyzx Placeholder");

  const grid = page.getByTestId("grid");
  await grid.evaluate((element) => {
    element.scrollTop = element.scrollHeight / 2;
  });
  await expect(page.locator('[data-row="0"]')).toHaveCount(0);

  await grid.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(cell(page, 0, 1)).toHaveText("Zzyzx Placeholder");
});

test("deletes a selected range and the count drops by exactly that much", async ({ page }) => {
  await ready(page);
  const before = await rowCount(page);

  await page.locator('[data-row="2"]').click();
  await page.locator('[data-row="6"]').click({ modifiers: ["Shift"] });

  // The toolbar only offers the delete once something is selected.
  await expect(page.getByTestId("delete")).toHaveText("5");
  await page.getByTestId("delete").click();

  await expect.poll(() => rowCount(page)).toBe(before - 5);
});

test("keeps its frame rate while scrolling", async ({ page }) => {
  await ready(page);

  const { longest, longestFrame, frames } = await page.evaluate(async () => {
    // Long tasks are what dropped frames look like from the outside, but
    // the entry type only fires above 50ms, so seeing none is the same as
    // seeing nothing. Frame intervals are measured alongside it, which
    // gives a real number whether or not the API is there.
    const tasks: number[] = [];
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) tasks.push(entry.duration);
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // Not every engine ships longtask.
    }

    const grid = document.querySelector('[data-testid="grid"]') as HTMLElement;
    const intervals: number[] = [];
    let previous = performance.now();

    for (let i = 0; i < 90; i++) {
      grid.scrollTop = i * 2000;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const now = performance.now();
      intervals.push(now - previous);
      previous = now;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
    observer?.disconnect();

    return {
      longest: tasks.length ? Math.max(...tasks) : 0,
      // The first interval includes getting into the loop, so it is not a
      // frame and is dropped.
      longestFrame: Math.max(...intervals.slice(1)),
      frames: intervals.length,
    };
  });

  console.log(
    `scroll: ${frames} frames, longest frame ${longestFrame.toFixed(1)}ms, ` +
      `longest task ${longest.toFixed(1)}ms`
  );

  expect(longest).toBeLessThan(50);
  // A frame budget of 50ms is three frames at 60Hz: generous, and still
  // far below what re-rendering 200k rows would cost.
  expect(longestFrame).toBeLessThan(50);

  // And the grid is still showing rows from where it ended up.
  await expect(page.locator('[role="row"]').first()).toBeVisible();
});

test("grid screenshot", async ({ page }, testInfo) => {
  await ready(page);
  await page.locator('[data-row="3"]').click();
  await page.locator('[data-row="6"]').click({ modifiers: ["Shift"] });

  const file = testInfo.outputPath("grid.png");
  await page.screenshot({ path: file });
  await testInfo.attach("grid", { path: file, contentType: "image/png" });
  console.log(`screenshot: ${file}`);
});
