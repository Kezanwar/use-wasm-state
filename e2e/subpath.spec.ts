import { expect, test } from "@playwright/test";

/**
 * The production build, served from a sub-directory the way GitHub Pages
 * does. An absolute asset path works everywhere except there, which is the
 * worst place to find out.
 */

const SUBPATH = "http://localhost:4178/use-wasm-state/";
const BAD_MIME = "http://localhost:4178/badmime/";

test("runs from a sub-directory", async ({ page }) => {
  await page.goto(SUBPATH);
  await expect(page.getByTestId("row-count")).toHaveText("200,000", { timeout: 60_000 });
});

test("serves the engine as application/wasm, so the compile can stream", async ({ page }) => {
  const types: string[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith(".wasm")) types.push(response.headers()["content-type"] ?? "");
  });

  await page.goto(SUBPATH);
  await expect(page.getByTestId("row-count")).toHaveText("200,000", { timeout: 60_000 });
  expect(types).toContain("application/wasm");
});

test("falls back when the host sends the wrong MIME type", async ({ page }) => {
  // compileStreaming rejects outright on a wrong content-type, so the
  // loader's buffered fallback is not optional on static hosts.
  await page.goto(BAD_MIME);
  await expect(page.getByTestId("row-count")).toHaveText("200,000", { timeout: 60_000 });
});
