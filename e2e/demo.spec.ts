import { expect, test } from "@playwright/test";

/**
 * Smoke test for the scaffold: the demo builds, resolves the package through
 * the workspace link and renders. The real browser suite (a Blob-URL module
 * worker, a structured-cloned WebAssembly.Module, a 200k-row grid scrolling
 * at frame rate) arrives with the demo grid in build step 6.
 */
test("the demo renders and sees the package", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "use-wasm-state" })).toBeVisible();
  await expect(page.getByTestId("package-version")).toHaveText(/\d+\.\d+\.\d+/);
});
