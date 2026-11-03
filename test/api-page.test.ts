import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as pkg from "../src/index";
import { API, DOCUMENTED } from "../examples/react-demo/src/lib/api";

/**
 * The API page against the package.
 *
 * A docs page drifts the moment someone adds an export and forgets it.
 * This makes that a failing test rather than a thing a reader notices
 * later. Both directions matter: an undocumented export is a hole, and a
 * documented one that no longer exists is a lie.
 */

/**
 * Type-only exports cannot be seen at runtime, so they are listed here.
 * Adding one to src/index.ts without adding it here fails the last test
 * in this file, which reads the source rather than the module.
 */
const TYPE_EXPORTS = [
  "ColumnArray",
  "ColumnKind",
  "ColumnsInput",
  "Engine",
  "EngineOptions",
  "FilterClause",
  "NumericOp",
  "Row",
  "RowIds",
  "SchemaSpec",
  "SortDirection",
  "SortSpec",
  "StringOp",
  "TableQuery",
  "TableSchema",
  "TableStats",
  "TableStore",
  "TableView",
  "UseWasmTableOptions",
  "UseWasmTableResult",
  "ValueOf",
  "WasmStateErrorCode",
];

const documented = new Set(DOCUMENTED);

describe("the API page", () => {
  it("documents every value the package exports", () => {
    const missing = Object.keys(pkg).filter((name) => !documented.has(name));
    expect(missing, "add these to examples/react-demo/src/lib/api.ts").toEqual([]);
  });

  it("documents every type the package exports", () => {
    const missing = TYPE_EXPORTS.filter((name) => !documented.has(name));
    expect(missing, "add these to examples/react-demo/src/lib/api.ts").toEqual([]);
  });

  it("documents nothing the package does not export", () => {
    const known = new Set([...Object.keys(pkg), ...TYPE_EXPORTS]);
    const extra = DOCUMENTED.filter((name) => !known.has(name));
    expect(extra, "these are on the API page but not exported").toEqual([]);
  });

  it("gives every entry a signature naming it", () => {
    for (const [name, signature] of Object.entries(API)) {
      expect(signature.length, name).toBeGreaterThan(10);
      expect(signature, name).toContain(name);
    }
  });

  it("lists every type export that src/index.ts declares", () => {
    // TYPE_EXPORTS is hand-written because types vanish at runtime. This
    // reads the barrel file so the list cannot quietly fall behind it.
    const source = readFileSync(resolve(process.cwd(), "src/index.ts"), "utf8");
    const declared = new Set<string>();
    for (const block of source.matchAll(/export type \{([^}]*)\}/g)) {
      for (const name of block[1]!.split(",")) {
        const trimmed = name.trim();
        if (trimmed) declared.add(trimmed);
      }
    }

    expect([...declared].sort()).toEqual([...TYPE_EXPORTS].sort());
  });
});
