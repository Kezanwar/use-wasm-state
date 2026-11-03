import { expect, test } from "@playwright/test";
import { cell, MODES, ready, rowCount } from "./helpers";

/**
 * The browser is the only place the real thing runs: 200k rows in wasm, a
 * virtualised grid, and a scroll that has to hold its frame rate. Every
 * test here runs on both engines, because the point of worker mode is that
 * nothing above it changes.
 */

const ROWS = 200_000;

for (const mode of MODES) {
  test(`${mode}: loads 200,000 rows`, async ({ page }) => {
    await ready(page, mode);

    await expect(page.getByTestId("revision")).toHaveText("r1");
    // Only the visible slice exists in the DOM; the rest is scroll height.
    const rendered = await page.locator('[role="row"]').count();
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(200);
  });

  test(`${mode}: scrolls to the bottom and renders the last row`, async ({ page }) => {
    await ready(page, mode);

    const grid = page.getByTestId("grid");
    await grid.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });

    const last = page.locator(`[data-row="${ROWS - 1}"]`);
    await expect(last).toBeVisible({ timeout: 15_000 });
    // ids are 1-based in the generator, so the last row shows 200000.
    await expect(last.locator('[role="gridcell"]').first()).toHaveText("200000");
  });

  test(`${mode}: edits a price, and the cell and revision update`, async ({ page }) => {
    await ready(page, mode);

    const price = cell(page, 0, 5);
    const before = await price.textContent();

    await price.dblclick();
    const editor = page.getByTestId("cell-editor");
    await editor.fill("1234.56");
    await editor.press("Enter");

    await expect(price).toHaveText("$1,234.56");
    expect(await price.textContent()).not.toBe(before);
    await expect(page.getByTestId("revision")).toHaveText("r2");
    await expect(page.getByTestId("last-ms")).not.toBeEmpty();
  });

  test(`${mode}: a new string survives scrolling away and back`, async ({ page }) => {
    await ready(page, mode);

    // A value the column has never held, so the engine appends a
    // dictionary entry and the JS mirror has to pick it up.
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
    await expect(cell(page, 0, 1)).toHaveText("Zzyzx Placeholder", { timeout: 15_000 });
  });

  test(`${mode}: deletes a selected range and the count drops by exactly that much`, async ({
    page,
  }) => {
    await ready(page, mode);
    const before = await rowCount(page);

    await page.locator('[data-row="2"]').click();
    await page.locator('[data-row="6"]').click({ modifiers: ["Shift"] });

    await expect(page.getByTestId("delete")).toHaveText("5");
    await page.getByTestId("delete").click();

    await expect.poll(() => rowCount(page)).toBe(before - 5);
  });

  test(`${mode}: keeps its frame rate while scrolling`, async ({ page }) => {
    await ready(page, mode);

    const { longest, longestFrame, frames } = await page.evaluate(async () => {
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
        // The first interval includes getting into the loop.
        longestFrame: Math.max(...intervals.slice(1)),
        frames: intervals.length,
      };
    });

    console.log(
      `${mode} scroll: ${frames} frames, longest frame ${longestFrame.toFixed(1)}ms, ` +
        `longest task ${longest.toFixed(1)}ms`
    );

    expect(longest).toBeLessThan(50);
    expect(longestFrame).toBeLessThan(50);
    await expect(page.locator('[role="row"]').first()).toBeVisible();
  });
}

test("worker: a fast scroll never blanks the grid", async ({ page }) => {
  await ready(page, "worker");

  // A worker answers a window a round trip later. Rather than showing
  // nothing, the grid draws the nearest rows it has at their real offset,
  // so there is never a frame with no rows in it.
  const empty = await page.evaluate(async () => {
    const grid = document.querySelector('[data-testid="grid"]') as HTMLElement;
    let blanks = 0;
    for (let i = 0; i < 60; i++) {
      grid.scrollTop = (i * 97_000) % grid.scrollHeight;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (document.querySelectorAll('[role="row"]').length === 0) blanks++;
    }
    return blanks;
  });

  expect(empty).toBe(0);
});

test("worker: a sort on 200k rows keeps the frames coming", async ({ page }) => {
  await ready(page, "worker");

  const { longest, longestFrame, medianFrame } = await page.evaluate(async () => {
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

    const header = document.querySelector('[data-testid="sort-price"]') as HTMLElement;
    const intervals: number[] = [];
    let previous = performance.now();

    // The sort itself happens off this thread, so the page keeps painting
    // through it. That is the whole point of worker mode.
    for (let i = 0; i < 6; i++) {
      header.click();
      for (let frame = 0; frame < 10; frame++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const now = performance.now();
        intervals.push(now - previous);
        previous = now;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
    observer?.disconnect();

    const sorted = [...intervals.slice(1)].sort((a, b) => a - b);
    return {
      longest: tasks.length ? Math.max(...tasks) : 0,
      longestFrame: sorted.at(-1)!,
      medianFrame: sorted[Math.floor(sorted.length / 2)]!,
    };
  });

  console.log(
    `worker sort: median frame ${medianFrame.toFixed(1)}ms, longest ${longestFrame.toFixed(1)}ms, ` +
      `longest task ${longest.toFixed(1)}ms`
  );

  expect(longest).toBeLessThan(50);
  // The median is the claim: the page keeps painting while 200k rows are
  // sorted off-thread. The frame each sort lands on is allowed to cost
  // more, because every visible row changes and React re-renders them all;
  // what must not happen is the page stopping.
  expect(medianFrame).toBeLessThan(20);
  expect(longestFrame).toBeLessThan(100);
});

test("switching modes keeps the rows and the query", async ({ page }) => {
  await ready(page, "sync");

  await page.getByTestId("sort-price").click();
  await expect(page.getByTestId("sort-price")).toHaveAttribute("aria-sort", "ascending");
  await page.getByTestId("search").fill("ship");
  await expect.poll(() => rowCount(page)).toBeLessThan(200_000);

  const filtered = await rowCount(page);
  const firstRow = await cell(page, 0, 0).textContent();

  await page.getByTestId("mode-worker").click();
  await expect(page.getByTestId("mode-worker")).toHaveAttribute("aria-pressed", "true");

  await expect.poll(() => rowCount(page), { timeout: 30_000 }).toBe(filtered);
  await expect(page.getByTestId("sort-price")).toHaveAttribute("aria-sort", "ascending");
  await expect(page.getByTestId("search")).toHaveValue("ship");
  await expect(cell(page, 0, 0)).toHaveText(firstRow!);
});
