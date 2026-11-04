import { expect, test } from "@playwright/test";
import { ROUTES } from "./helpers";

/**
 * The production build, served from a sub-directory the way GitHub Pages
 * does. An absolute asset path works everywhere except there, which is the
 * worst place to find out.
 *
 * The grid is what proves the engine actually loaded, so these go straight
 * to the Examples tab rather than the site root.
 */

const SUBPATH = "http://localhost:4178/use-wasm-state/";
const EXAMPLES = `${SUBPATH}datagrid/examples`;

test("runs from a sub-directory", async ({ page }) => {
  await page.goto(EXAMPLES);
  await expect(page.getByTestId("row-count")).toHaveText("200,000", { timeout: 60_000 });
});

for (const [path, heading] of ROUTES) {
  test(`/${path} loads from a direct visit and a refresh`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${SUBPATH}${path}`);
    await expect(page.getByText(heading, { exact: true }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByText(heading, { exact: true }).first()).toBeVisible();
    // Hydration mismatches surface as errors; a pre-rendered page has none.
    expect(errors).toEqual([]);
  });
}

test("/datagrid redirects to its first page", async ({ page }) => {
  await page.goto(`${SUBPATH}datagrid`);
  await expect(page).toHaveURL(`${SUBPATH}datagrid/start`);
});

test("serves the engine as application/wasm, so the compile can stream", async ({ page }) => {
  const types: string[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith(".wasm")) types.push(response.headers()["content-type"] ?? "");
  });

  await page.goto(EXAMPLES);
  await expect(page.getByTestId("row-count")).toHaveText("200,000", { timeout: 60_000 });
  expect(types).toContain("application/wasm");
});

test("falls back when the host sends the wrong MIME type", async ({ page }) => {
  // compileStreaming rejects outright on a wrong content-type, so the
  // loader's buffered fallback is not optional on static hosts.
  const types: string[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith(".wasm")) types.push(response.headers()["content-type"] ?? "");
  });
  await page.goto(`${EXAMPLES}?badmime`);
  await expect(page.getByTestId("row-count")).toHaveText("200,000", { timeout: 60_000 });
  expect(types).toContain("application/octet-stream");
});

test("a strict worker-src still loads the worker", async ({ page }) => {
  // The worker is a real module beside the bundle, not a blob, so a CSP
  // naming worker-src 'self' allows it. A blob: worker would be refused
  // here, which is the whole reason workerUrl exists as an escape hatch.
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) violations.push(message.text());
  });

  await page.goto(`${EXAMPLES}?csp`);
  await expect(page.getByTestId("row-count")).toHaveText("200,000", { timeout: 60_000 });

  await page.getByTestId("mode-worker").click();
  await expect(page.getByTestId("row-count")).toHaveText("200,000", { timeout: 60_000 });
  expect(page.locator('[role="row"]').first()).toBeTruthy();
  expect(violations).toEqual([]);
});
