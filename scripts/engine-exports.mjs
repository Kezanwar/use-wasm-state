/**
 * The exact shape src/datagrid/datagrid.wasm is expected to have.
 *
 * One source of truth for the audit: scripts/inspect-wasm.mjs reads it, and
 * src/datagrid/abi.ts declares the same ABI names in ENGINE_EXPORTS. An export
 * appearing here that is not in abi.ts, or the other way round, means the
 * module and its bindings have drifted.
 */

/** Everything engine/cmd/datagrid/main.go marks //go:wasmexport, in declaration order. */
export const ABI_EXPORTS = [
  "inputBuffer",
  "alloc",
  "free",
  "liveBytes",
  "createGrid",
  "dropGrid",
  "reserveRows",
  "commitRows",
  "setCellI32",
  "setCellF64",
  "setCellString",
  "deleteRows",
  "setQuery",
  "revision",
  "rowCount",
  "totalRows",
  "dictLen",
  "view",
  "dictSince",
];

/**
 * What the toolchain adds on top. `memory` is the linear memory every
 * pointer is an offset into; `_initialize` is the WASI reactor entry point
 * the loader calls before anything else.
 */
export const RUNTIME_EXPORTS = ["memory", "_initialize"];

/** Every export the module must have. A missing one fails the audit. */
export const REQUIRED_EXPORTS = [...RUNTIME_EXPORTS, ...ABI_EXPORTS];

/**
 * Exports TinyGo emits for its own libm shims. Tolerated but not required,
 * because the set moves between TinyGo releases; an upgrade that adds one
 * will fail the audit until it is listed here, which is the point.
 */
export const TOLERATED_EXPORTS = ["fminimum", "fminimumf", "fmaximum", "fmaximumf"];
