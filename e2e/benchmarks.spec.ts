import { expect, test } from "@playwright/test";

/**
 * The Benchmarks tab: the published figures, a live run, and the same grid
 * sorting under JS and under the engine in a worker.
 */

test("shows the published figures and where they came from", async ({ page }) => {
  await page.goto("/#benchmarks");
  await expect(page.getByTestId("speed-chart")).toBeVisible();
  const published = page.getByTestId("bench-published");
  await expect(published).toContainText("Node");
  // One row per operation, plus memory.
  await expect(published.locator("tbody tr")).toHaveCount(18);
  await expect(page.getByTestId("bench-summary")).toContainText(/Wasm is fastest at \d+ of \d+/);
});

test("runs on this machine without freezing the page", async ({ page }) => {
  // ?quick shrinks the run to seconds; the runner and the page are the same.
  await page.goto("/?quick#benchmarks");
  await page.getByTestId("bench-run").click();

  // Sample frames for the length of the run. It pauses between samples, so
  // the page keeps painting; the longest frame is one sample, not the run.
  const longest = await page.evaluate(async () => {
    let previous = performance.now();
    let worst = 0;
    while (!document.querySelector('[data-testid="bench-frames"]')) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const now = performance.now();
      worst = Math.max(worst, now - previous);
      previous = now;
    }
    return worst;
  });

  await expect(page.getByTestId("bench-live").locator("tbody tr").first()).toBeVisible();
  await expect(page.getByTestId("bench-frames").locator("tbody tr")).toHaveCount(4);
  await expect(page.getByTestId("bench-show-live")).toHaveAttribute("aria-pressed", "true");
  expect(longest).toBeLessThan(500);
});

test("the same sort costs frames under JS and none in a worker", async ({ page }) => {
  await page.goto("/#benchmarks");
  const js = page.getByTestId("side-js");
  const wasm = page.getByTestId("side-wasm");
  await expect(js.locator('[role="row"]').first()).toBeVisible({ timeout: 60_000 });
  await expect(wasm.locator('[role="row"]').first()).toBeVisible({ timeout: 60_000 });

  const worst = async (pane: "side-js" | "side-wasm") => {
    const cost = page.getByTestId(`${pane}-cost`);
    await expect(cost).toContainText("longest frame", { timeout: 30_000 });
    return Number((await cost.textContent())!.match(/longest frame ([\d.]+)/)![1]);
  };

  await js.getByTestId("sort-price").click();
  const jsWorst = await worst("side-js");
  await wasm.getByTestId("sort-price").click();
  const wasmWorst = await worst("side-wasm");

  console.log(`sorting 200k rows: typical JS longest frame ${jsWorst}ms, worker ${wasmWorst}ms`);
  expect(jsWorst).toBeGreaterThan(wasmWorst);

  // Both sides sorted, by the same Grid, to the same first row.
  await expect(js.getByTestId("sort-price")).toHaveAttribute("aria-sort", "ascending");
  await expect(wasm.getByTestId("sort-price")).toHaveAttribute("aria-sort", "ascending");
  await expect(js.locator('[data-row="0"] [role="gridcell"]').first()).toHaveText(
    (await wasm.locator('[data-row="0"] [role="gridcell"]').first().textContent())!
  );

  // And the tuned baseline is a click away on the left.
  await page.getByTestId("side-tuned").click();
  await expect(js.locator('[role="row"]').first()).toBeVisible({ timeout: 60_000 });
});
