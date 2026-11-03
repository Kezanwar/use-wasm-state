import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Published figures cannot drift from measured ones.
 *
 * The README's numbers are rendered from benchmarks.json and the committed
 * module. Nothing is re-measured here, so this is cheap and runs in CI:
 * it fails when either has changed without the other.
 */

const root = process.cwd();

describe("the README's benchmark block", () => {
  it("matches benchmarks.json and the committed datagrid.wasm", () => {
    expect(() =>
      execFileSync("node", ["scripts/readme-benchmarks.mjs", "--check"], {
        cwd: root,
        stdio: "pipe",
      })
    ).not.toThrow();
  });

  it("is the only place the README states a timing", () => {
    // Anything that looks like a measurement outside the generated block is
    // a number someone typed, and will be wrong the next time it is run.
    const readme = readFileSync(resolve(root, "README.md"), "utf8");
    const outside = readme.replace(/<!-- benchmarks:start -->[\s\S]*<!-- benchmarks:end -->/, "");
    expect(outside).not.toMatch(/\d\s?(ms|µs|us|ns|kB|MB)\b/);
  });

  it("records where and how the figures were measured", () => {
    const figures = JSON.parse(readFileSync(resolve(root, "benchmarks.json"), "utf8"));
    expect(figures.machine.cpu).toBeTruthy();
    expect(figures.runtime.version).toMatch(/^v\d+/);
    expect(figures.rows).toBe(200_000);
    expect(figures.operations.length).toBeGreaterThan(10);
  });
});
