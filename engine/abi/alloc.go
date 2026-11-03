package abi

import "unsafe"

// Go's GC cannot see that JavaScript is holding an offset, so every block
// handed out stays reachable from here until Free is called. A deliberately
// plain allocator: it does not track sizes or reuse blocks, because the
// engine's own long-lived storage is ordinary Go memory and this only has to
// carry arguments across the boundary.
var live = map[uintptr][]byte{}

// Alloc reserves size bytes and returns the offset to write them at, or nil
// for a non-positive size.
//
// The result is always 8-byte aligned. JS maps a Float64Array straight onto
// these bytes, and that constructor throws on a misaligned offset, so the
// alignment is part of the contract rather than a detail. Go's allocator
// only promises pointer alignment, which is 4 bytes in wasm32, so the block
// is over-allocated and the offset pushed up to the next boundary.
func Alloc(size int32) unsafe.Pointer {
	if size <= 0 {
		return nil
	}
	raw := make([]byte, int(size)+7)
	ptr := unsafe.Pointer(&raw[alignPad(raw)])
	// Keyed by the aligned offset JS was given, holding the whole block so
	// the padding stays reachable too.
	live[uintptr(ptr)] = raw
	return ptr
}

// Free releases a block from Alloc. Freeing something else, or twice, is a
// no-op rather than a trap: JS getting this wrong should leak, not crash the
// module out from under the page.
func Free(ptr unsafe.Pointer) {
	delete(live, uintptr(ptr))
}

// LiveBlocks is how many Alloc'd blocks have not been freed. For tests.
func LiveBlocks() int { return len(live) }

func align8(n uintptr) uintptr { return (n + 7) &^ 7 }

// AlignUp is align8 for sizes and offsets rather than addresses: what a
// pattern lays its own buffers out with, so every section starts on an
// 8-byte boundary.
func AlignUp(n int) int { return (n + 7) &^ 7 }

// Pack squeezes an (offset, length) pair into one int64, which arrives in
// JavaScript as a bigint. It is how an export returns a buffer when wasm
// only lets it return one value. Zero means failure, which is unambiguous
// because offset zero is never handed out.
//
// The offset half is 32 bits, which is the whole of a wasm32 address space
// and therefore lossless there. On a 64-bit host the pointer is truncated
// and the result is meaningless; nothing calls this outside wasm.
func Pack(ptr unsafe.Pointer, n int) int64 {
	if ptr == nil || n < 0 {
		return 0
	}
	return packParts(uint32(uintptr(ptr)), uint32(n))
}

// packParts is Pack's arithmetic on plain integers, so the format can be
// tested on a host whose pointers do not fit in the top half.
func packParts(off, n uint32) int64 {
	return int64(off)<<32 | int64(n)
}

// alignPad is how many bytes into b the first 8-byte boundary falls.
func alignPad(b []byte) int {
	if len(b) == 0 {
		return 0
	}
	base := uintptr(unsafe.Pointer(&b[0]))
	return int(align8(base) - base)
}
