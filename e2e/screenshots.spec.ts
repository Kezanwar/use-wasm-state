import { expect, test, type Page } from "@playwright/test";

/**
 * One screenshot per tab, in both themes. Not assertions: these are the
 * artifacts to look at when something reads wrong but nothing fails.
 */

const TABS = ["start", "examples", "api"] as const;

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.addInitScript((value) => {
    try {
      localStorage.setItem("theme", value);
    } catch {
      // Blocked storage: index.html falls back to dark, which is the
      // default anyway.
    }
  }, theme);
}

for (const theme of ["dark", "light"] as const) {
  for (const tab of TABS) {
    test(`${tab} in ${theme}`, async ({ page }, testInfo) => {
      await setTheme(page, theme);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/#${tab}`);

      // The grid loads 200k rows; without waiting the Examples shot is of
      // a skeleton.
      if (tab === "examples") {
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
