import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The shell: tabs, deep links, and the two header buttons that do work. */

const tabs = [
  ["start", "Install"],
  ["examples", "Basic"],
  ["benchmarks", "Frames"],
  ["api", "Hooks"],
] as const;

for (const [hash, heading] of tabs) {
  test(`#${hash} deep-links to its tab`, async ({ page }) => {
    await page.goto(`/#${hash}`);
    await expect(page.getByTestId(`tab-${hash}`)).toHaveAttribute("data-state", "active");
    await expect(page.getByText(heading, { exact: true }).first()).toBeVisible();
  });
}

test("clicking a tab moves the hash, and back returns", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("tab-start")).toHaveAttribute("data-state", "active");

  await page.getByTestId("tab-api").click();
  await expect(page).toHaveURL(/#api$/);
  await expect(page.getByTestId("tab-api")).toHaveAttribute("data-state", "active");

  await page.goBack();
  await expect(page.getByTestId("tab-start")).toHaveAttribute("data-state", "active");
});

test("an unknown hash falls back to the first tab", async ({ page }) => {
  await page.goto("/#nonsense");
  await expect(page.getByTestId("tab-start")).toHaveAttribute("data-state", "active");
});

test("Copy for LLM puts llm.md on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");

  await page.getByTestId("copy-llm").click();

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const onDisk = readFileSync(resolve(process.cwd(), "llm.md"), "utf8");
  // The file shipped with the package is the file this button copies.
  expect(copied).toBe(onDisk);
});

test("the theme toggle flips the document class", async ({ page }) => {
  await page.goto("/");
  const dark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));

  const before = await dark();
  await page.getByTestId("theme-toggle").click();
  expect(await dark()).toBe(!before);
});
