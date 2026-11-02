/**
 * Copied from react-use-wasm src/memory.ts.
 * Keep in sync until extracted to a shared core.
 *
 * Changes from the original: the error prefix is "use-wasm-state" rather
 * than "useWasm", since nothing here is a hook. The API is identical.
 */

/**
 * The JavaScript half of the linear-memory protocol.
 *
 * A wasm function only takes and returns numbers, so anything larger travels
 * as an offset into `exports.memory.buffer` — one flat ArrayBuffer both sides
 * can read and write. Doing that by hand means allocating, writing, calling
 * with `(offset, length)`, reading back and freeing, in that order, without
 * ever mixing up bytes and element counts.
 *
 * A scope owns all of it:
 *
 *   const sorted = withScope(exports, (s) => {
 *     const xs = s.i32ArrayArg([5, 3, 9, 1]);
 *     exports.sortInt32(xs.ptr, xs.len);
 *     return xs.read();
 *   });
 *
 * Everything the scope allocated is freed when the body returns, including
 * when it throws.
 */

/* ------------------------------------------------------------------ */
/* The contract                                                        */
/* ------------------------------------------------------------------ */

/**
 * What a module must export for the memory helpers to work. Declare your
 * exports interface as extending this and `withScope` becomes callable.
 *
 * TinyGo and hand-written modules usually name these `alloc` and `free`.
 * Emscripten ships `malloc`/`free`; pass {@link AllocatorNames} for anything
 * that differs.
 */
export interface WasmAllocator {
  memory: WebAssembly.Memory;
  /** Reserve `size` bytes and return the offset to write them at. */
  alloc(size: number): number;
  /** Release a block previously returned by alloc. */
  free(ptr: number): void;
}

/** Override the export names, for toolchains that don't use alloc/free. */
export interface AllocatorNames {
  /** Default: "alloc". */
  alloc?: string;
  /** Default: "free". */
  free?: string;
  /** Default: "memory". */
  memory?: string;
}

interface Allocator {
  memory: WebAssembly.Memory;
  alloc: (size: number) => number;
  free: (ptr: number) => void;
}

/**
 * Pull the allocator out of an exports object, or throw naming what's
 * missing alongside what the module actually exports. Getting this wrong is
 * usually a naming mismatch, so the message has to show both sides.
 */
export function resolveAllocator(exports: object, names?: AllocatorNames): Allocator {
  const allocName = names?.alloc ?? "alloc";
  const freeName = names?.free ?? "free";
  const memoryName = names?.memory ?? "memory";

  const record = exports as Record<string, unknown>;
  const alloc = record[allocName];
  const free = record[freeName];
  const memory = record[memoryName] as WebAssembly.Memory | undefined;

  const missing: string[] = [];
  if (typeof alloc !== "function") missing.push(allocName);
  if (typeof free !== "function") missing.push(freeName);
  if (!memory || typeof (memory as { buffer?: unknown }).buffer !== "object") {
    missing.push(memoryName);
  }

  if (missing.length > 0) {
    const available = Object.keys(record).join(", ") || "(none)";
    throw new Error(
      `use-wasm-state: the memory helpers need exports "${allocName}", "${freeName}" and "${memoryName}". ` +
        `Missing: ${missing.join(", ")}. Module exports: ${available}. ` +
        `If your toolchain names them differently, pass ` +
        `{ allocator: { alloc: "malloc", free: "free" } }.`
    );
  }

  return {
    memory: memory as WebAssembly.Memory,
    alloc: alloc as (size: number) => number,
    free: free as (ptr: number) => void,
  };
}

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

/**
 * A reserved region of linear memory, owned by the scope that made it.
 *
 * `len` is what the wasm function wants (element count for arrays, byte
 * length for strings and bytes). `byteLength` is what was allocated. They
 * differ by 4 for Int32Array and 8 for Float64Array, which is the single
 * easiest thing to get wrong by hand.
 */
export interface WasmBlock<R> {
  /** Offset into linear memory: the first argument wasm expects. */
  readonly ptr: number;
  /** Element count for arrays, byte length for strings and bytes. */
  readonly len: number;
  /** Bytes reserved. */
  readonly byteLength: number;
  /**
   * Copy the current contents out as a JS value. Always a copy, never a
   * view, so it stays valid after the scope frees the block.
   */
  read(): R;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* ------------------------------------------------------------------ */
/* Scope                                                               */
/* ------------------------------------------------------------------ */

/**
 * Allocators bound to one module, valid only inside the `withScope` body.
 *
 * `*Arg` helpers copy data in and are what you pass to a function.
 * `*Out` helpers reserve empty space for a function to write into.
 */
export interface WasmScope {
  /** Raw reservation, when none of the typed helpers fit. */
  alloc(byteLength: number): WasmBlock<Uint8Array>;

  /** UTF-8 encode a string, write it, and size `len` in *bytes*. */
  stringArg(text: string): WasmBlock<string>;
  /** Write raw bytes. */
  bytesArg(data: Uint8Array): WasmBlock<Uint8Array>;
  /** Write an Int32Array (or anything array-like of numbers). */
  i32ArrayArg(xs: Int32Array | ArrayLike<number>): WasmBlock<Int32Array>;
  /** Write a Float64Array (or anything array-like of numbers). */
  f64ArrayArg(xs: Float64Array | ArrayLike<number>): WasmBlock<Float64Array>;

  /** Reserve `byteLength` zeroed bytes for wasm to write into. */
  bytesOut(byteLength: number): WasmBlock<Uint8Array>;
  /** Reserve space for `len` int32s for wasm to write into. */
  i32ArrayOut(len: number): WasmBlock<Int32Array>;
  /** Reserve space for `len` float64s for wasm to write into. */
  f64ArrayOut(len: number): WasmBlock<Float64Array>;
}

const RELEASED =
  "use-wasm-state: this scope has already exited. Read everything you need inside the withScope body.";

function isThenable(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Run `body` with a scope, then free everything it allocated.
 *
 * The body must be synchronous. An async one would return a pending promise,
 * the scope would free immediately, and the real work would then run against
 * released memory — so that throws rather than silently misbehaving.
 */
export function withScope<R>(
  exports: WasmAllocator,
  body: (s: WasmScope) => R,
  names?: AllocatorNames
): R {
  const { memory, alloc, free } = resolveAllocator(exports, names);

  const owned: number[] = [];
  let released = false;

  /** Views are made fresh every time: a grow detaches every older one. */
  const u8 = () => new Uint8Array(memory.buffer);

  const reserve = (byteLength: number): number => {
    if (released) throw new Error(RELEASED);
    if (byteLength <= 0) {
      throw new Error(`use-wasm-state: cannot allocate ${byteLength} bytes`);
    }
    const ptr = alloc(byteLength);
    if (!ptr) throw new Error(`use-wasm-state: alloc(${byteLength}) returned 0`);
    owned.push(ptr);
    return ptr;
  };

  const block = <R2>(
    ptr: number,
    len: number,
    byteLength: number,
    read: () => R2
  ): WasmBlock<R2> => ({
    ptr,
    len,
    byteLength,
    read: () => {
      if (released) throw new Error(RELEASED);
      return read();
    },
  });

  const scope: WasmScope = {
    alloc(byteLength) {
      const ptr = reserve(byteLength);
      return block(
        ptr,
        byteLength,
        byteLength,
        () => new Uint8Array(memory.buffer.slice(ptr, ptr + byteLength))
      );
    },

    stringArg(text) {
      const data = encoder.encode(text);
      // Byte length, not text.length: a non-ASCII character is 2-4 bytes and
      // sizing from the string would silently truncate it.
      const ptr = reserve(data.byteLength);
      u8().set(data, ptr);
      return block(ptr, data.byteLength, data.byteLength, () =>
        decoder.decode(memory.buffer.slice(ptr, ptr + data.byteLength))
      );
    },

    bytesArg(data) {
      const ptr = reserve(data.byteLength);
      u8().set(data, ptr);
      return block(
        ptr,
        data.byteLength,
        data.byteLength,
        () => new Uint8Array(memory.buffer.slice(ptr, ptr + data.byteLength))
      );
    },

    i32ArrayArg(xs) {
      const src = xs instanceof Int32Array ? xs : Int32Array.from(xs);
      const ptr = reserve(src.byteLength);
      new Int32Array(memory.buffer, ptr, src.length).set(src);
      return block(
        ptr,
        src.length,
        src.byteLength,
        () => new Int32Array(memory.buffer.slice(ptr, ptr + src.byteLength))
      );
    },

    f64ArrayArg(xs) {
      const src = xs instanceof Float64Array ? xs : Float64Array.from(xs);
      const ptr = reserve(src.byteLength);
      new Float64Array(memory.buffer, ptr, src.length).set(src);
      return block(
        ptr,
        src.length,
        src.byteLength,
        () => new Float64Array(memory.buffer.slice(ptr, ptr + src.byteLength))
      );
    },

    bytesOut(byteLength) {
      return scope.alloc(byteLength);
    },

    i32ArrayOut(len) {
      const byteLength = len * 4;
      const ptr = reserve(byteLength);
      return block(
        ptr,
        len,
        byteLength,
        () => new Int32Array(memory.buffer.slice(ptr, ptr + byteLength))
      );
    },

    f64ArrayOut(len) {
      const byteLength = len * 8;
      const ptr = reserve(byteLength);
      return block(
        ptr,
        len,
        byteLength,
        () => new Float64Array(memory.buffer.slice(ptr, ptr + byteLength))
      );
    },
  };

  try {
    const result = body(scope);
    if (isThenable(result)) {
      throw new Error(
        "use-wasm-state: the withScope body must be synchronous. An async body frees " +
          "its memory before the work runs. Read what you need inside the body, " +
          "or await outside it."
      );
    }
    return result;
  } finally {
    released = true;
    for (const ptr of owned) free(ptr);
    owned.length = 0;
  }
}

/* ------------------------------------------------------------------ */
/* Packed returns                                                      */
/* ------------------------------------------------------------------ */

/**
 * Split an `(offset, length)` pair that a module packed into one i64.
 *
 * Wasm returns a single value, so a function handing back freshly allocated
 * data has to squash both numbers together: offset in the high 32 bits,
 * length in the low 32. It arrives in JS as a bigint.
 */
export function unpack(packed: bigint): { ptr: number; len: number } {
  return { ptr: Number(packed >> 32n), len: Number(packed & 0xffffffffn) };
}

/**
 * Read the bytes a packed return points at, then free them.
 *
 * `0n` is the conventional failure signal and gives back `null`.
 *
 * Only for data the module freshly allocated with the same allocator. A
 * pointer into static data would be freed wrongly.
 */
export function bytesVal(
  exports: WasmAllocator,
  packed: bigint,
  names?: AllocatorNames
): Uint8Array | null {
  if (packed === 0n) return null;
  const { memory, free } = resolveAllocator(exports, names);
  const { ptr, len } = unpack(packed);
  try {
    return new Uint8Array(memory.buffer.slice(ptr, ptr + len));
  } finally {
    free(ptr);
  }
}

/** As {@link bytesVal}, decoded as UTF-8. `0n` gives back `null`. */
export function stringVal(
  exports: WasmAllocator,
  packed: bigint,
  names?: AllocatorNames
): string | null {
  const bytes = bytesVal(exports, packed, names);
  return bytes === null ? null : decoder.decode(bytes);
}

/* ------------------------------------------------------------------ */
/* Odds and ends                                                       */
/* ------------------------------------------------------------------ */

/** How much linear memory the module currently owns, in bytes. */
export function memorySize(exports: WasmAllocator, names?: AllocatorNames): number {
  return resolveAllocator(exports, names).memory.buffer.byteLength;
}
