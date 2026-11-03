import { test, type Page } from "@playwright/test";
import { MODES, ready, type Mode } from "./helpers";

/**
 * What React costs in the grid, per interaction.
 *
 * Run against the dev server, which serves React's development build, so
 * the Profiler reports real numbers. The figures are relative: what
 * matters is the same scenario before and after a change.
 *
 *   pnpm exec playwright test e2e/profile.spec.ts
 */

interface Commit {
  phase: string;
  duration: number;
}

async function measure(page: Page, run: () => Promise<void>) {
  await page.evaluate(() => {
    (globalThis as { __commits?: Commit[] }).__commits = [];
  });
  await run();
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const commits = (globalThis as { __commits?: Commit[] }).__commits ?? [];
    const durations = commits.map((c) => c.duration).sort((a, b) => a - b);
    const total = durations.reduce((sum, d) => sum + d, 0);
    return {
      commits: durations.length,
      total,
      worst: durations.at(-1) ?? 0,
      median: durations[Math.floor(durations.length / 2)] ?? 0,
    };
  });
}

const line = (label: string, m: Awaited<ReturnType<typeof measure>>) =>
  `  ${label.padEnd(22)} commits ${String(m.commits).padStart(3)}  ` +
  `total ${m.total.toFixed(1).padStart(7)}ms  ` +
  `worst ${m.worst.toFixed(1).padStart(6)}ms  median ${m.median.toFixed(1)}ms`;

for (const mode of MODES) {
  test(`${mode}: react cost`, async ({ page }) => {
    await ready(page, mode as Mode);

    const sort = await measure(page, async () => {
      await page.getByTestId("sort-price").click();
    });

    const firstKey = await measure(page, async () => {
      await page.getByTestId("search").fill("s");
    });

    const nextKeys = await measure(page, async () => {
      for (const text of ["sh", "shi", "ship"]) {
        await page.getByTestId("search").fill(text);
      }
    });

    await page.getByTestId("search").fill("");
    await page.waitForTimeout(300);

    const scroll = await measure(page, async () => {
      await page.evaluate(async () => {
        const grid = document.querySelector('[data-testid="grid"]') as HTMLElement;
        for (let i = 0; i < 40; i++) {
          grid.scrollTop = i * 2000;
          await new Promise((r) => requestAnimationFrame(r));
        }
      });
    });

    console.log(`\n${mode}:`);
    console.log(line("sort", sort));
    console.log(line("first keystroke", firstKey));
    console.log(line("3 more keystrokes", nextKeys));
    console.log(line("40 scroll steps", scroll));
  });
}
