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
const read = (f: string) => readFileSync(dist(f), "utf8");
const built = existsSync(dist("index.js")) && existsSync(dist("datagrid.js"));

/** The two entries a consumer imports, in both module formats. */
const ENTRIES = ["index", "datagrid"] as const;
const BUNDLES = ENTRIES.flatMap((name) => [`${name}.js`, `${name}.cjs`]);

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

describe.skipIf(!built)("dist", () => {
  it('starts every entry with "use client"', () => {
    // Next.js App Router only treats a module as client code if the
    // directive is the very first statement. tsup's treeshake pass silently
    // strips it, which is why treeshake is off in tsup.config.ts.
    for (const file of BUNDLES) {
      expect(read(file).split("\n")[0]!.trim(), file).toBe('"use client";');
    }
  });

  it("ships type declarations for every entry in both module formats", () => {
    for (const name of ENTRIES) {
      expect(existsSync(dist(`${name}.d.ts`)), name).toBe(true);
      expect(existsSync(dist(`${name}.d.cts`)), name).toBe(true);
    }
  });

  it("keeps every entry self-contained", () => {
    // A bundler copying a worker as an asset URL copies that one file, and
    // one that imported a shared chunk would 404 on it, in the production
    // build and nowhere else. The main entries are held to the same rule:
    // no relative imports at all, so each stands on its own.
    for (const file of [...BUNDLES, "datagrid.worker.js"]) {
      const code = read(file);
      expect(code, file).not.toMatch(/from\s*["']\.\.?\//);
      expect(code, file).not.toMatch(/import\s*\(\s*["']\.\.?\//);
      expect(code, file).not.toMatch(/require\(\s*["']\.\.?\//);
    }
  });

  it("ships the datagrid's worker as its own bundle, without React", () => {
    // The worker carries the engine and nothing else: the main entries
    // import React, which a worker has no business loading.
    const worker = read("datagrid.worker.js");
    expect(worker).not.toMatch(/from ["']react["']/);
    expect(worker).not.toMatch(/require\(["']react["']\)/);
  });

  it("resolves the datagrid's engine and worker from beside its own entry", () => {
    // new URL("./x", import.meta.url) needs the file next to datagrid.js,
    // not in a sub-directory, and the same name the exports map gives it.
    const entry = read("datagrid.js");
    expect(entry).toContain('new URL("./datagrid.wasm", import.meta.url)');
    expect(entry).toContain('new URL("./datagrid.worker.js", import.meta.url)');

    expect(readFileSync(dist("datagrid.wasm"))).toEqual(
      readFileSync(resolve(root, "src/datagrid/datagrid.wasm"))
    );
    expect(existsSync(dist("datagrid.worker.js"))).toBe(true);
    expect(pkg.exports["./datagrid.wasm"]).toBe("./dist/datagrid.wasm");
    expect(pkg.exports["./datagrid.worker.js"]).toBe("./dist/datagrid.worker.js");
  });

  it("maps both entries, for both resolvers", () => {
    for (const [path, name] of [
      [".", "index"],
      ["./datagrid", "datagrid"],
    ] as const) {
      expect(pkg.exports[path], path).toEqual({
        types: `./dist/${name}.d.ts`,
        import: `./dist/${name}.js`,
        require: `./dist/${name}.cjs`,
      });
    }
    // moduleResolution "node" ignores exports; this is how it finds the
    // subpath's types.
    expect(pkg.typesVersions["*"].datagrid).toEqual(["./dist/datagrid.d.ts"]);
  });

  it("declares each entry's public exports in its types", () => {
    const expected = {
      index: [
        "WasmStateSyncProvider",
        "WasmStateAsyncProvider",
        "useWasmStateSync",
        "useWasmStateAsync",
        "WasmStateError",
        "WasmStateErrorCode",
        "WasmStateDef",
      ],
      datagrid: [
        "useWasmDataGridSync",
        "useWasmDataGridAsync",
        "useDataGridView",
        "useDataGridStats",
        "useDataGridQuery",
        "defineDataGrid",
        "defineSchema",
        "DataGridStore",
        "AsyncDataGridStore",
        "AnyDataGridStore",
        "DataGridView",
        "DataGridDef",
      ],
    };
    for (const name of ENTRIES) {
      const types = read(`${name}.d.ts`);
      for (const symbol of expected[name]) expect(types, `${name}: ${symbol}`).toContain(symbol);
    }
  });

  it("keeps the internals out of the public types", () => {
    // Loading a module, the provider registry and the definition contract
    // are this package's own plumbing. Exporting them would turn
    // implementation detail into API every later version has to keep.
    const internal = {
      index: ["createRegistry", "useSharedState", "StateDef", "Pattern", "loadModule"],
      datagrid: ["loadSyncEngine", "WorkerClient", "withInput", "unpack", "createGridHost"],
    };
    for (const name of ENTRIES) {
      // Declarations only: module headers ride along as comments, and they
      // are allowed to name the code they describe.
      const types = read(`${name}.d.ts`).replace(/\/\*[\s\S]*?\*\//g, "");
      for (const symbol of internal[name]) {
        expect(types, `${name}: ${symbol}`).not.toMatch(new RegExp(`\\b${symbol}\\b`));
      }
    }
  });

  it("knows nothing about the datagrid in the root", () => {
    const code = read("index.js") + read("index.d.ts");
    expect(code).not.toMatch(/datagrid|DataGrid|insertColumns/);
  });

  it("leaves no bare import.meta in any CJS bundle", () => {
    // The datagrid resolves its engine and worker with
    // new URL("./x", import.meta.url). CJS has no import.meta, so tsup's
    // `shims` rewrites it; without that the bundle throws on require()
    // before a consumer can even pass wasmUrl instead.
    for (const name of ENTRIES) {
      expect(read(`${name}.cjs`), name).not.toMatch(/\bimport\s*\.\s*meta\b/);
    }
  });

  it("has no runtime dependencies", () => {
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toEqual({ react: ">=18" });
    expect(pkg.sideEffects).toBe(false);
  });

  it("keeps react external", () => {
    for (const name of ENTRIES) {
      expect(read(`${name}.js`), name).toMatch(/from ["']react["']/);
      expect(read(`${name}.cjs`), name).toMatch(/require\(["']react["']\)/);
    }
  });
});
