import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as root from "../src/index";
import * as datagrid from "../src/datagrid/index";
import { DATAGRID_API, DOCUMENTED, ROOT_API } from "../examples/react-demo/src/lib/api";

/**
 * The API page against the package, one entry point at a time.
 *
 * A docs page drifts the moment someone adds an export and forgets it.
 * This makes that a failing test rather than a thing a reader notices
 * later. Both directions matter: an undocumented export is a hole, and a
 * documented one that no longer exists is a lie. And each name has to be
 * documented under the entry it actually comes from.
 */

/** Type-only exports vanish at runtime, so they are read from the barrel. */
function typeExports(barrel: string): string[] {
  const source = readFileSync(resolve(process.cwd(), barrel), "utf8");
  const names = new Set<string>();
  for (const block of source.matchAll(/export type \{([^}]*)\}/g)) {
    for (const name of block[1]!.split(",")) {
      const trimmed = name.trim();
      if (trimmed) names.add(trimmed);
    }
  }
  return [...names].sort();
}

const ENTRIES = [
  {
    name: "use-wasm-state",
    module: root,
    barrel: "src/index.ts",
    documented: DOCUMENTED.root,
    api: ROOT_API as Record<string, string>,
  },
  {
    name: "use-wasm-state/datagrid",
    module: datagrid,
    barrel: "src/datagrid/index.ts",
    documented: DOCUMENTED.datagrid,
    api: DATAGRID_API as Record<string, string>,
  },
];

for (const entry of ENTRIES) {
  describe(`the API page: ${entry.name}`, () => {
    const documented = new Set(entry.documented);
    const types = typeExports(entry.barrel);

    it("documents every value it exports", () => {
      const missing = Object.keys(entry.module).filter((name) => !documented.has(name));
      expect(missing, "add these to examples/react-demo/src/lib/api.ts").toEqual([]);
    });

    it("documents every type it exports", () => {
      const missing = types.filter((name) => !documented.has(name));
      expect(missing, "add these to examples/react-demo/src/lib/api.ts").toEqual([]);
    });

    it("documents nothing it does not export", () => {
      const known = new Set([...Object.keys(entry.module), ...types]);
      const extra = entry.documented.filter((name) => !known.has(name));
      expect(extra, "these are on the API page but not exported from here").toEqual([]);
    });

    it("gives every entry a signature naming it", () => {
      for (const [name, signature] of Object.entries(entry.api)) {
        expect(signature.length, name).toBeGreaterThan(10);
        expect(signature, name).toContain(name);
      }
    });
  });
}

describe("the API page", () => {
  it("never documents one name under both entries", () => {
    const both = DOCUMENTED.root.filter((name) => DOCUMENTED.datagrid.includes(name));
    expect(both).toEqual([]);
  });
});
