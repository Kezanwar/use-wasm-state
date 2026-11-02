/**
 * Public surface of use-wasm-state.
 *
 * Nothing from src/internal/ is exported here on purpose: those files are
 * copies of react-use-wasm's helpers, kept private until they are extracted
 * into a shared core. Re-exporting them would make a second copy of that
 * API something we have to support.
 *
 * The hooks, the provider and the table types land in build steps 5 and 9.
 */

/** Package version, so the demo and bug reports can name an exact build. */
export const VERSION = "0.0.0";
