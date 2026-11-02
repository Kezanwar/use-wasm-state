import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Copied from react-use-wasm test/dist-output.test.ts and trimmed to what
 * the package exports today. Keep in sync until extracted to a shared core.
 *
 * Guards the published artefact. Run `pnpm build` first; these skip if dist
 * is absent so `vitest` alone still works on a clean checkout.
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
    for (const name of ["VERSION"]) {
      expect(types, name).toContain(name);
    }
  });

  it("keeps the internal helpers out of the public types", () => {
    // They are react-use-wasm's API, copied in. Re-exporting them would
    // make a second copy of it something this package has to support.
    const types = readFileSync(dist("index.d.ts"), "utf8");
    for (const name of ["withScope", "loadModule", "WASM_WORKER_SOURCE"]) {
      expect(types, name).not.toContain(name);
    }
  });

  it("has no runtime dependencies", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toEqual({ react: ">=18" });
    expect(pkg.sideEffects).toBe(false);
  });

  it("reports the version the package.json declares", async () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const { VERSION } = await import("../src/index");
    expect(VERSION).toBe(pkg.version);
  });
});
