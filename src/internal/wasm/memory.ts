/**
 * The two things every caller of a wasm module needs: the shape of a module
 * that owns memory, and the arithmetic for reading a buffer back out of it.
 *
 * There is deliberately no per-call scope allocator here. Allocating and
 * freeing a block per operation is the opposite of what this engine wants:
 * arguments go through its own grow-only input buffer and results are read
 * out of its own output buffers, so steady state allocates nothing. See
 * withInput in src/engine/input.ts.
 */

/**
 * What a module must export for anything here to work.
 *
 * TinyGo and hand-written modules usually name these `alloc` and `free`.
 */
export interface WasmAllocator {
  memory: WebAssembly.Memory;
  /** Reserve `size` bytes and return the offset to write them at. */
  alloc(size: number): number;
  /** Release a block previously returned by alloc. */
  free(ptr: number): void;
}

/**
 * Split an `(offset, length)` pair that a module packed into one i64.
 *
 * Wasm returns a single value, so a function handing back a buffer has to
 * squash both numbers together: offset in the high 32 bits, length in the
 * low 32. It arrives in JS as a bigint. Zero means failure, which is
 * unambiguous because offset zero is never handed out.
 */
export function unpack(packed: bigint): { ptr: number; len: number } {
  return { ptr: Number(packed >> 32n), len: Number(packed & 0xffffffffn) };
}
