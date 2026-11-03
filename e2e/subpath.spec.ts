import { expect, test } from "@playwright/test";

/**
 * The production build, served from a sub-directory the way GitHub Pages
 * does. An absolute asset path works everywhere except there, which is the
 * worst place to find out.
 *
 * The grid is what proves the engine actually loaded, so these go straight
 * to the Examples tab rather than the site root.
 */

const SUBPATH = "http://localhost:4178/use-wasm-state/";
const BAD_MIME = "http://localhost:4178/badmime/";

const loaded = (url: string) => `${url}#examples`;

test("runs from a sub-directory", async ({ page }) => {
  await page.goto(loaded(SUBPATH));
  await expect(page.getByTestId("row-count")).toHaveText("200,000", { timeout: 60_000 });
});

test("serves the engine as application/wasm, so the compile can stream", async ({ page }) => {
  const types: string[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith(".wasm")) types.push(response.headers()["content-type"] ?? "");
  });

  await page.goto(loaded(SUBPATH));
  await expect(page.getByTestId("row-count")).toHaveText("200,000", { timeout: 60_000 });
  expect(types).toContain("application/wasm");
});

test("falls back when the host sends the wrong MIME type", async ({ page }) => {
  // compileStreaming rejects outright on a wrong content-type, so the
  // loader's buffered fallback is not optional on static hosts.
  await page.goto(loaded(BAD_MIME));
  await expect(page.getByTestId("row-count")).toHaveText("200,000", { timeout: 60_000 });
});

test("a strict worker-src still loads the worker", async ({ page }) => {
  // The worker is a real module beside the bundle, not a blob, so a CSP
  // naming worker-src 'self' allows it. A blob: worker would be refused
  // here, which is the whole reason workerUrl exists as an escape hatch.
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) violations.push(message.text());
  });

  await page.goto("http://localhost:4178/csp/#examples");
  await expect(page.getByTestId("row-count")).toHaveText("200,000", { timeout: 60_000 });

  await page.getByTestId("mode-worker").click();
  await expect(page.getByTestId("row-count")).toHaveText("200,000", { timeout: 60_000 });
  expect(page.locator('[role="row"]').first()).toBeTruthy();
  expect(violations).toEqual([]);
});
