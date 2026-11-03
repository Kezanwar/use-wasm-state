import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the published artefact, which is the one thing no other test sees:
 * every assertion here is a bug that only shows up after `npm install`.
 *
 * Run `pnpm build` first. These skip when dist is absent, so `vitest` alone
 * still works on a clean checkout.
 */

const root = process.cwd();
const dist = (f: string) => resolve(root, "dist", f);
const built = existsSync(dist("index.js"));

describe.skipIf(!built)("dist", () => {
  it('starts both bundles with "use client"', () => {
    // Next.js App Router only treats a module as client code if the
    // directive is the very first statement. tsup's treeshake pass silently
    // strips it, which is why treeshake is off in tsup.config.ts.
    for (const file of ["index.js", "index.cjs"]) {
      const first = readFileSync(dist(file), "utf8").split("\n")[0]!.trim();
      expect(first, file).toBe('"use client";');
    }
  });

  it("ships type declarations for both module formats", () => {
    expect(existsSync(dist("index.d.ts"))).toBe(true);
    expect(existsSync(dist("index.d.cts"))).toBe(true);
  });

  it("ships the worker as its own bundle, without React", () => {
    // The worker carries the engine and nothing else: the main entry
    // imports React, which a worker has no business loading.
    expect(existsSync(dist("worker.js"))).toBe(true);
    const worker = readFileSync(dist("worker.js"), "utf8");
    expect(worker).not.toMatch(/from ["']react["']/);
    expect(worker).not.toMatch(/require\(["']react["']\)/);
  });

  it("keeps the worker self-contained", () => {
    // A bundler copying worker.js as an asset URL copies that one file.
    // If it imported a shared chunk, the worker would 404 on it in the
    // production build and nowhere else, which is how this was found.
    const worker = readFileSync(dist("worker.js"), "utf8");
    expect(worker).not.toMatch(/from\s*["']\.\/chunk-/);
    expect(worker).not.toMatch(/import\s*\(\s*["']\.\//);
  });

  it("ships the engine next to the bundles", () => {
    // Consumers resolve it with new URL("./engine.wasm", import.meta.url),
    // so it has to sit beside index.js, not in a sub-directory.
    expect(existsSync(dist("engine.wasm"))).toBe(true);
    expect(readFileSync(dist("engine.wasm"))).toEqual(
      readFileSync(resolve(root, "src/wasm/engine.wasm"))
    );
  });

  it("declares every public export in the types", () => {
    const types = readFileSync(dist("index.d.ts"), "utf8");
    for (const name of [
      "createEngine",
      "defineSchema",
      "useWasmTable",
      "useTableView",
      "WasmStateError",
      "TableStore",
      "TableView",
      "Row",
      "RowIds",
    ]) {
      expect(types, name).toContain(name);
    }
  });

  it("leaves no bare import.meta in the CJS bundle", () => {
    // createEngine resolves its default engine.wasm with
    // new URL("./engine.wasm", import.meta.url). CJS has no import.meta,
    // so tsup's `shims` rewrites it; without that the bundle throws on
    // require() before a consumer can even pass wasmUrl instead.
    const cjs = readFileSync(dist("index.cjs"), "utf8");
    expect(cjs).not.toMatch(/\bimport\s*\.\s*meta\b/);
  });

  it("keeps the internal helpers out of the public types", () => {
    // Loading a module and packing a pointer are this engine's own
    // plumbing. Exporting them would turn an implementation detail into
    // API that every later version has to keep working.
    const types = readFileSync(dist("index.d.ts"), "utf8");
    for (const name of ["unpack", "loadModule", "createHost", "withInput"]) {
      expect(types, name).not.toContain(name);
    }
  });

  it("has no runtime dependencies", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toEqual({ react: ">=18" });
    expect(pkg.sideEffects).toBe(false);
  });

  it("keeps react external", () => {
    expect(readFileSync(dist("index.js"), "utf8")).toMatch(/from ["']react["']/);
    expect(readFileSync(dist("index.cjs"), "utf8")).toMatch(/require\(["']react["']\)/);
  });
});
