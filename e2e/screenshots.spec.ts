import { expect, test, type Page } from "@playwright/test";
import { ROUTES } from "./helpers";

/**
 * One screenshot per page, in both themes. Not assertions: these are the
 * artifacts to look at when something reads wrong but nothing fails.
 */

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.addInitScript((value) => {
    try {
      localStorage.setItem("theme", value);
    } catch {
      // Blocked storage: root.tsx falls back to dark, which is the
      // default anyway.
    }
  }, theme);
}

for (const theme of ["dark", "light"] as const) {
  for (const [path] of ROUTES) {
    const tab = path.replace("datagrid/", "datagrid-") || "core";
    test(`${tab} in ${theme}`, async ({ page }, testInfo) => {
      await setTheme(page, theme);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(path);

      // The grid loads 200k rows; without waiting the Examples shot is of
      // a skeleton.
      if (path === "datagrid/examples") {
        await expect(page.getByTestId("row-count")).toHaveText("200,000", { timeout: 60_000 });
      }
      await page.waitForTimeout(300);

      const file = testInfo.outputPath(`${tab}-${theme}.png`);
      // Full page everywhere: the grid sits in a fixed-height card, so
      // this captures it rather than six million pixels of rows.
      await page.screenshot({ path: file, fullPage: true });
      await testInfo.attach(`${tab}-${theme}`, { path: file, contentType: "image/png" });
      console.log(`screenshot: ${file}`);
    });
  }
}
