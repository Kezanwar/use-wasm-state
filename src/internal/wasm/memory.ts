/**
 * Copied from react-use-wasm src/memory.ts.
 * Keep in sync until extracted to a shared core.
 *
 * Only two things survived the copy. The scope allocator and the packed
 * readers that went with it (withScope, stringVal, bytesVal,
 * resolveAllocator) were deleted in build step 4b: they allocate and free a
 * block per operation, which is the opposite of what this engine needs. Its
 * arguments go through the engine-owned input buffer instead, and its
 * results are read out of engine-owned output buffers. See withInput in
 * src/engine/input.ts and "Memory model" in the architecture notes.
 *
 * What is left is the shape of a module that owns memory, and the one piece
 * of arithmetic both halves still speak.
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
