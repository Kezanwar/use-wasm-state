import { describe, expect, it } from "vitest";
import {
  bytesVal,
  memorySize,
  resolveAllocator,
  stringVal,
  unpack,
  withScope,
  type WasmAllocator,
} from "../../src/internal/wasm/memory";
import { watToWasm } from "../helpers/wat";

/**
 * Copied from react-use-wasm test/memory.test.ts.
 * Keep in sync until extracted to a shared core.
 *
 * One change: react-use-wasm runs these against its committed memory.wasm,
 * built from Go. There is no equivalent module here, so they run against
 * test/fixtures/alloc.wat instead — same export shapes, no TinyGo needed.
 *
 * Still a real module rather than a mock allocator: the whole point of this
 * layer is getting byte counts and pointers right, which a fake would not
 * catch.
 */

interface AllocExports extends WasmAllocator {
  _initialize(): void;
  sumInt32(ptr: number, len: number): number;
  sortInt32(ptr: number, len: number): void;
  upperInPlace(ptr: number, len: number): void;
  scaleFloat64(ptr: number, len: number, by: number): void;
  centroid(ptr: number, count: number, out: number): void;
  reverseString(ptr: number, len: number): bigint;
  statsOrZero(ptr: number, len: number): bigint;
}

async function ready(): Promise<AllocExports> {
  const { instance } = await WebAssembly.instantiate(await watToWasm("alloc"), {});
  const exports = instance.exports as unknown as AllocExports;
  exports._initialize();
  return exports;
}

/**
 * WebAssembly's exports object is frozen, so vi.spyOn cannot touch it.
 * A shallow copy with a counting free is enough to watch the scope clean up.
 */
function countingFrees(e: AllocExports) {
  let frees = 0;
  const wrapped = {
    ...e,
    free: (ptr: number) => {
      frees += 1;
      e.free(ptr);
    },
  } as AllocExports;
  return { wrapped, frees: () => frees };
}

describe("resolveAllocator", () => {
  it("finds alloc, free and memory under their default names", async () => {
    const e = await ready();
    const a = resolveAllocator(e);
    expect(typeof a.alloc).toBe("function");
    expect(typeof a.free).toBe("function");
    expect(a.memory).toBeInstanceOf(WebAssembly.Memory);
  });

  it("honours renamed exports", async () => {
    const e = await ready();
    const renamed = { heap: e.memory, malloc: e.alloc, release: e.free };
    const a = resolveAllocator(renamed, {
      alloc: "malloc",
      free: "release",
      memory: "heap",
    });
    expect(a.memory).toBe(e.memory);
  });

  it("names what is missing and lists what the module does export", async () => {
    const { instance } = await WebAssembly.instantiate(await watToWasm("math"), {});
    expect(() => resolveAllocator(instance.exports)).toThrowError(/Missing: alloc, free/);
    expect(() => resolveAllocator(instance.exports)).toThrowError(/Module exports: .*\bfib\b/);
  });

  it("points at the allocator option, since a rename is the usual cause", async () => {
    expect(() => resolveAllocator({})).toThrowError(/allocator: \{ alloc: "malloc"/);
  });
});

describe("withScope", () => {
  it("passes an Int32Array in and reads the sorted result back", async () => {
    const e = await ready();
    const sorted = withScope(e, (s) => {
      const xs = s.i32ArrayArg([5, 3, 9, 1, 7]);
      expect(e.sumInt32(xs.ptr, xs.len)).toBe(25);
      e.sortInt32(xs.ptr, xs.len);
      return [...xs.read()];
    });
    expect(sorted).toEqual([1, 3, 5, 7, 9]);
  });

  it("sizes an Int32Array allocation in bytes but reports len in elements", async () => {
    const e = await ready();
    withScope(e, (s) => {
      const xs = s.i32ArrayArg([1, 2, 3]);
      expect(xs.len).toBe(3);
      expect(xs.byteLength).toBe(12);
    });
  });

  it("sizes a string by its UTF-8 byte length, not its character count", async () => {
    const e = await ready();
    withScope(e, (s) => {
      const text = s.stringArg("héllo"); // 5 chars, 6 bytes
      expect(text.len).toBe(6);
      expect(text.read()).toBe("héllo");
    });
  });

  it("round-trips a string through an in-place wasm mutation", async () => {
    const e = await ready();
    const upper = withScope(e, (s) => {
      const text = s.stringArg("hello wasm");
      e.upperInPlace(text.ptr, text.len);
      return text.read();
    });
    expect(upper).toBe("HELLO WASM");
  });

  it("reserves out-parameters for wasm to write into", async () => {
    const e = await ready();
    const centroid = withScope(e, (s) => {
      const pts = s.f64ArrayArg([0, 0, 10, 0, 10, 10, 0, 10]);
      const out = s.f64ArrayOut(2);
      e.centroid(pts.ptr, pts.len / 2, out.ptr);
      return [...out.read()];
    });
    expect(centroid).toEqual([5, 5]);
  });

  it("scales a Float64Array in place", async () => {
    const e = await ready();
    const scaled = withScope(e, (s) => {
      const xs = s.f64ArrayArg([1, 2, 3]);
      e.scaleFloat64(xs.ptr, xs.len, 2.5);
      return [...xs.read()];
    });
    expect(scaled).toEqual([2.5, 5, 7.5]);
  });

  it("writes bytes verbatim and reads them back", async () => {
    const e = await ready();
    const out = withScope(e, (s) => {
      const b = s.bytesArg(new Uint8Array([0, 127, 255]));
      expect(b.len).toBe(3);
      return [...b.read()];
    });
    expect(out).toEqual([0, 127, 255]);
  });

  it("frees everything it allocated", async () => {
    const { wrapped, frees } = countingFrees(await ready());

    withScope(wrapped, (s) => {
      s.stringArg("a");
      s.i32ArrayArg([1]);
      s.f64ArrayOut(2);
    });
    expect(frees()).toBe(3);
  });

  it("still frees when the body throws", async () => {
    const { wrapped, frees } = countingFrees(await ready());

    expect(() =>
      withScope(wrapped, (s) => {
        s.stringArg("a");
        s.i32ArrayArg([1]);
        throw new Error("boom");
      })
    ).toThrowError("boom");
    expect(frees()).toBe(2);
  });

  it("rejects an async body rather than freeing underneath it", async () => {
    const e = await ready();
    expect(() => withScope(e, async (s) => s.stringArg("a").read())).toThrowError(
      /must be synchronous/
    );
  });

  it("refuses to allocate or read once the scope has exited", async () => {
    const e = await ready();
    let escaped!: { read: () => string };
    withScope(e, (s) => {
      escaped = s.stringArg("hello");
    });
    expect(() => escaped.read()).toThrowError(/already exited/);
  });

  it("survives a grow: views are taken fresh, never cached", async () => {
    const e = await ready();
    const before = memorySize(e);
    const out = withScope(e, (s) => {
      const first = s.stringArg("hello");
      // Big enough to force the module to grow its linear memory.
      s.alloc(4 * 1024 * 1024);
      return first.read();
    });
    expect(out).toBe("hello");
    expect(memorySize(e)).toBeGreaterThan(before);
  });
});

describe("packed returns", () => {
  it("unpacks an (offset, length) pair out of one i64", () => {
    expect(unpack((123n << 32n) | 45n)).toEqual({ ptr: 123, len: 45 });
  });

  it("reads and frees a freshly allocated string", async () => {
    const { wrapped, frees } = countingFrees(await ready());
    const reversed = withScope(wrapped, (s) => {
      const text = s.stringArg("hello wasm");
      return stringVal(wrapped, wrapped.reverseString(text.ptr, text.len));
    });
    expect(reversed).toBe("msaw olleh");
    // One for the packed return, one for the scope's own block.
    expect(frees()).toBe(2);
  });

  it("treats 0n as the failure signal", async () => {
    const e = await ready();
    const stats = withScope(e, (s) => {
      const text = s.stringArg("not json at all");
      return stringVal(e, e.statsOrZero(text.ptr, text.len));
    });
    expect(stats).toBeNull();
  });

  it("returns raw bytes when you don't want them decoded", async () => {
    const e = await ready();
    const bytes = withScope(e, (s) => {
      const text = s.stringArg("ab");
      return bytesVal(e, e.reverseString(text.ptr, text.len));
    });
    expect([...bytes!]).toEqual([98, 97]); // "ba"
  });
});
