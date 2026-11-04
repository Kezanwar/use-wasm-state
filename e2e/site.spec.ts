import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROUTES } from "./helpers";

/** The shell: routes, the pattern tabs and sidebar, anchors, and the header buttons. */

for (const [path, heading] of ROUTES) {
  test(`/${path} loads from a direct visit and a refresh`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByText(heading, { exact: true }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByText(heading, { exact: true }).first()).toBeVisible();
  });
}

for (const [hash, path] of [
  ["start", "datagrid/start"],
  ["examples", "datagrid/examples"],
  ["benchmarks", "datagrid/benchmarks"],
  ["api", "datagrid/api"],
] as const) {
  test(`the old #${hash} link redirects to /${path}`, async ({ page }) => {
    await page.goto(`#${hash}`);
    await expect(page).toHaveURL(new RegExp(`/use-wasm-state/${path}$`));
  });
}

for (const id of ["WasmStateDef", "providers"]) {
  test(`the old Core link #${id} redirects to /core#${id}`, async ({ page }) => {
    await page.goto(`#${id}`);
    await expect(page).toHaveURL(new RegExp(`/use-wasm-state/core#${id}$`));
    await expect(page.locator(`#${id}`)).toBeInViewport();
  });
}

test("the home page links its headline result to the benchmarks", async ({ page }) => {
  await page.goto("");
  await expect(page.getByTestId("home-result")).toContainText(/\d/);
  await page.getByTestId("home-result").getByRole("link").click();
  await expect(page).toHaveURL(/\/datagrid\/benchmarks$/);
});

test("the pattern tabs and the sidebar move between routes, and back returns", async ({ page }) => {
  await page.goto("");
  await expect(page.getByTestId("tab-home")).toHaveAttribute("data-state", "active");

  await page.getByTestId("tab-core").click();
  await expect(page).toHaveURL(/\/core$/);
  await expect(page.getByTestId("tab-core")).toHaveAttribute("data-state", "active");

  await page.getByTestId("tab-datagrid").click();
  await expect(page).toHaveURL(/\/datagrid\/start$/);
  await expect(page.getByTestId("tab-datagrid")).toHaveAttribute("data-state", "active");

  await page.getByTestId("nav-api").click();
  await expect(page).toHaveURL(/\/datagrid\/api$/);
  await expect(page.getByTestId("nav-api")).toHaveAttribute("aria-current", "page");

  await page.goBack();
  await expect(page).toHaveURL(/\/datagrid\/start$/);
});

test("the sidebar is a menu on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("datagrid/start");
  await expect(page.getByTestId("nav-api")).toBeHidden();
  await page.getByRole("button", { name: "Getting started" }).click();
  await page.getByTestId("nav-api").click();
  await expect(page).toHaveURL(/\/datagrid\/api$/);
  await expect(page.getByTestId("nav-api")).toBeHidden();
});

test("an API definition is a stable anchor", async ({ page }) => {
  await page.goto("datagrid/api#DataGridStore");
  await expect(page.locator("#DataGridStore")).toBeInViewport();
});

test("a type in a signature links to its definition, on the page and on Core", async ({ page }) => {
  await page.goto("datagrid/api");

  await page.locator("#useDataGridView pre a", { hasText: "DataGridReader" }).click();
  await expect(page).toHaveURL(/\/datagrid\/api#DataGridReader$/);
  await expect(page.locator("#DataGridReader")).toBeInViewport();

  await page.locator("#defineDataGrid pre a", { hasText: "DataGridDef" }).first().click();
  await expect(page.locator("#DataGridDef")).toBeInViewport();

  // The shared API is a link away, and Core's signatures link the same way.
  await page.getByRole("link", { name: "Core", exact: true }).last().click();
  await expect(page).toHaveURL(/\/use-wasm-state\/core$/);
  await page.locator("#WasmState pre a", { hasText: "WasmStateDef" }).click();
  await expect(page).toHaveURL(/\/use-wasm-state\/core#WasmStateDef$/);
  await expect(page.locator("#WasmStateDef")).toBeInViewport();
});

test("Copy for LLM puts llm.md on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("");

  await page.getByTestId("copy-llm").click();

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const onDisk = readFileSync(resolve(process.cwd(), "llm.md"), "utf8");
  // The file shipped with the package is the file this button copies.
  expect(copied).toBe(onDisk);
});

test("the theme toggle flips the document class", async ({ page }) => {
  await page.goto("");
  const dark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));

  const before = await dark();
  await page.getByTestId("theme-toggle").click();
  expect(await dark()).toBe(!before);
});
