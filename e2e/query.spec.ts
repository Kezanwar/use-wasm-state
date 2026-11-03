import { expect, test, type Page } from "@playwright/test";
import { ready, rowCount } from "./helpers";

/** Sort, filter and search, against 200k real rows in a browser. */

/** The price column, as a number, for the first n rendered rows. */
async function prices(page: Page, n: number) {
  const cells = page.locator('[role="row"] [role="gridcell"]:nth-child(6)');
  const texts = await cells.allTextContents();
  return texts.slice(0, n).map((text) => Number(text.replace(/[^0-9.]/g, "")));
}

const statuses = (page: Page) =>
  page.locator('[role="row"] [role="gridcell"]:nth-child(3)').allTextContents();

test("sorting by price cycles ascending, descending, off", async ({ page }) => {
  await ready(page);
  const first = () => page.locator('[data-row="0"] [role="gridcell"]').first().textContent();
  const unsorted = await first();

  await page.getByTestId("sort-price").click();
  await expect(page.getByTestId("sort-price")).toHaveAttribute("aria-sort", "ascending");
  const ascending = await prices(page, 10);
  expect([...ascending].sort((a, b) => a - b)).toEqual(ascending);

  await page.getByTestId("sort-price").click();
  await expect(page.getByTestId("sort-price")).toHaveAttribute("aria-sort", "descending");
  const descending = await prices(page, 10);
  expect([...descending].sort((a, b) => b - a)).toEqual(descending);
  expect(descending[0]).toBeGreaterThan(ascending[0]!);

  // A third click clears it and the original order comes back.
  await page.getByTestId("sort-price").click();
  await expect(page.getByTestId("sort-price")).toHaveAttribute("aria-sort", "none");
  expect(await first()).toBe(unsorted);
});

test("shift-click adds a second sort column", async ({ page }) => {
  await ready(page);

  await page.getByTestId("sort-status").click();
  await page.getByTestId("sort-price").click({ modifiers: ["Shift"] });

  await expect(page.getByTestId("sort-status")).toHaveAttribute("aria-sort", "ascending");
  await expect(page.getByTestId("sort-price")).toHaveAttribute("aria-sort", "ascending");

  // Within the first status, price still runs upwards.
  const visible = await statuses(page);
  const within = (await prices(page, visible.length)).filter((_, i) => visible[i] === visible[0]);
  expect([...within].sort((a, b) => a - b)).toEqual(within);
});

test("search narrows the table and every visible row matches", async ({ page }) => {
  await ready(page);

  await page.getByTestId("search").fill("ship");
  await expect.poll(() => rowCount(page)).toBeLessThan(200_000);
  expect(await rowCount(page)).toBeGreaterThan(0);

  // Every rendered row contains the text somewhere in a string column.
  for (const row of await page.locator('[role="row"]').all()) {
    const text = (await row.textContent())?.toLowerCase() ?? "";
    expect(text).toContain("ship");
  }

  await page.getByTestId("search").fill("");
  await expect.poll(() => rowCount(page)).toBe(200_000);
});

test("a status filter and a search apply together", async ({ page }) => {
  await ready(page);

  // Turn every status off but one.
  for (const status of ["pending", "paid", "cancelled", "refunded"]) {
    await page.getByTestId(`status-${status}`).click();
  }
  await expect(page.getByTestId("status-shipped")).toHaveAttribute("aria-pressed", "true");

  const filtered = await rowCount(page);
  expect(filtered).toBeLessThan(200_000);
  expect(await statuses(page)).toEqual(Array((await statuses(page)).length).fill("shipped"));

  await page.getByTestId("search").fill("a");
  await expect.poll(() => rowCount(page)).toBeLessThan(filtered);

  // Still only shipped, and still matching the search.
  expect(new Set(await statuses(page))).toEqual(new Set(["shipped"]));
  for (const row of await page.locator('[role="row"]').all()) {
    expect((await row.textContent())?.toLowerCase()).toContain("a");
  }
});

test("editing a sorted cell moves the row", async ({ page }) => {
  await ready(page);

  await page.getByTestId("sort-price").click();
  await expect(page.getByTestId("sort-price")).toHaveAttribute("aria-sort", "ascending");

  const firstId = await page.locator('[data-row="0"] [role="gridcell"]').first().textContent();

  // Make the cheapest row the dearest; it has to leave the top.
  await page.locator('[data-row="0"] [role="gridcell"]').nth(5).dblclick();
  const editor = page.getByTestId("cell-editor");
  await editor.fill("999999");
  await editor.press("Enter");

  await expect
    .poll(async () => page.locator('[data-row="0"] [role="gridcell"]').first().textContent())
    .not.toBe(firstId);

  // And it is now at the very end.
  const grid = page.getByTestId("grid");
  await grid.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.locator('[data-row="199999"]')).toContainText("999,999");
});

test("typing in the search box drops no frames", async ({ page }) => {
  await ready(page);
  await page.getByTestId("search").click();

  const { cold, longest, longestFrame, frames } = await page.evaluate(async () => {
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

    const input = document.querySelector('[data-testid="search"]') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

    const type = async (text: string) => {
      const before = performance.now();
      setValue.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return performance.now() - before;
    };

    // The first search of a table lowercases every dictionary entry in
    // every string column. That is one-off work, not per-keystroke, so it
    // is measured on its own rather than blamed on typing.
    const cold = await type("s");
    setValue.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const intervals: number[] = [];
    for (const text of ["s", "sh", "shi", "ship", "shipp", "shippe", "shipped"]) {
      intervals.push(await type(text));
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
    observer?.disconnect();

    return {
      cold,
      longest: tasks.length ? Math.max(...tasks) : 0,
      longestFrame: Math.max(...intervals),
      frames: intervals.length,
    };
  });

  console.log(
    `search: first keystroke ${cold.toFixed(1)}ms, then ${frames} keystrokes with a ` +
      `longest frame of ${longestFrame.toFixed(1)}ms, longest task ${longest.toFixed(1)}ms`
  );

  expect(longest).toBeLessThan(50);
  expect(longestFrame).toBeLessThan(50);
  // The one-off cache build is allowed to cost more than a frame, but not
  // so much that the box feels stuck.
  expect(cold).toBeLessThan(150);
});
