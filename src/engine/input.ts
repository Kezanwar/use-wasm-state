/**
 * Writing arguments into the engine's input buffer.
 *
 * This replaces the alloc/free pair that used to wrap every call. The
 * module runs a collector that has to be given as little as possible to do,
 * so a grid editing a cell sixty times a second cannot be minting a block
 * each time. Instead the engine owns one buffer, hands out its offset, and
 * the next operation overwrites the same space. Nothing is ever freed.
 *
 * Internal. Not exported from src/index.ts.
 */

/** What withInput needs of a module: the buffer, and memory to write into. */
export interface InputHost {
  memory: WebAssembly.Memory;
  /** See inputBuffer in engine/main.go. Returns 0 for a non-positive size. */
  inputBuffer(minBytes: number): number;
}

/**
 * One argument's place in the input buffer.
 *
 * `len` is what the engine's parameter means: an element count for arrays,
 * a byte length for strings and bytes. `byteLength` is the space taken.
 * They differ by 4 for i32 and 8 for f64, which is the single easiest thing
 * to get wrong by hand.
 */
export interface InputBlock {
  /** Offset into linear memory: the pointer the engine expects. */
  readonly ptr: number;
  /** Element count for arrays, byte length for strings and bytes. */
  readonly len: number;
  /** Bytes reserved, including nothing else: padding sits outside it. */
  readonly byteLength: number;
}

/** An argument, described but not yet written. Build one with the helpers below. */
export interface InputArg {
  readonly byteLength: number;
  readonly len: number;
  write(memory: WebAssembly.Memory, ptr: number): void;
}

const encoder = new TextEncoder();

/** An Int32Array argument. `len` is the element count. */
export function i32In(values: ArrayLike<number>): InputArg {
  return {
    byteLength: values.length * 4,
    len: values.length,
    write(memory, ptr) {
      // A fresh view every time. inputBuffer may have grown linear memory,
      // and a grow detaches every view taken before it.
      new Int32Array(memory.buffer, ptr, values.length).set(values as ArrayLike<number>);
    },
  };
}

/** A Float64Array argument. `len` is the element count. */
export function f64In(values: ArrayLike<number>): InputArg {
  return {
    byteLength: values.length * 8,
    len: values.length,
    write(memory, ptr) {
      new Float64Array(memory.buffer, ptr, values.length).set(values as ArrayLike<number>);
    },
  };
}

/** A Uint32Array argument, for offset tables and descriptors. */
export function u32In(values: ArrayLike<number>): InputArg {
  return {
    byteLength: values.length * 4,
    len: values.length,
    write(memory, ptr) {
      new Uint32Array(memory.buffer, ptr, values.length).set(values as ArrayLike<number>);
    },
  };
}

/** Raw bytes. `len` is the byte length. */
export function bytesIn(data: Uint8Array): InputArg {
  return {
    byteLength: data.byteLength,
    len: data.byteLength,
    write(memory, ptr) {
      new Uint8Array(memory.buffer).set(data, ptr);
    },
  };
}

/**
 * A UTF-8 string. `len` is its *byte* length, not its character count: a
 * non-ASCII character is two to four bytes, and sizing from the string
 * would truncate it.
 *
 * Encoded here rather than at write time, because withInput has to know
 * every size before it asks for the buffer.
 */
export function stringIn(text: string): InputArg {
  return bytesIn(encoder.encode(text));
}

const alignUp = (n: number) => (n + 7) & ~7;

/**
 * Write one operation's arguments into the input buffer and run `body` with
 * their offsets.
 *
 * Arguments are described up front rather than written as you go, and that
 * is the whole point: every size, padding included, is totalled before the
 * buffer is asked for, so inputBuffer is called exactly once. Asking twice
 * would be a bug that mostly works, because growing moves the buffer and
 * quietly invalidates every offset handed out before it.
 *
 * Each block starts on an 8-byte boundary, so an f64 argument can be
 * written through a Float64Array; that constructor throws otherwise.
 *
 * Nothing is freed, and nothing may be held: the next operation writes over
 * the same space. Read what you need inside the body.
 *
 *   const status = withInput(exports, [i32In(rowIds)], ([ids]) =>
 *     exports.deleteRows(handle, ids.ptr, ids.len)
 *   );
 */
export function withInput<const A extends readonly InputArg[], R>(
  host: InputHost,
  args: A,
  body: (blocks: { readonly [K in keyof A]: InputBlock }) => R
): R {
  let total = 0;
  const offsets: number[] = [];
  for (const arg of args) {
    offsets.push(total);
    total += alignUp(arg.byteLength);
  }

  // An operation whose arguments are all empty needs no buffer at all. The
  // engine reads a null pointer with a zero length as "nothing", so the
  // blocks can point at 0.
  const base = total === 0 ? 0 : host.inputBuffer(total);
  if (total > 0 && base === 0) {
    throw new Error(`use-wasm-state: the engine could not provide ${total} bytes of input buffer`);
  }

  const blocks = args.map((arg, i) => {
    const ptr = base + offsets[i]!;
    if (arg.byteLength > 0) arg.write(host.memory, ptr);
    return {
      ptr: arg.byteLength > 0 ? ptr : 0,
      len: arg.len,
      byteLength: arg.byteLength,
    };
  });

  return body(blocks as { readonly [K in keyof A]: InputBlock });
}
