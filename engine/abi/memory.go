package abi

import "unsafe"

// BytesAt is the one piece of pointer arithmetic an export needs:
// everything else works on the []byte it returns. A nil pointer or a
// non-positive length gives a nil slice rather than a trap, so a malformed
// call is rejected by a decoder instead of killing the module.
func BytesAt(ptr unsafe.Pointer, n int32) []byte {
	if ptr == nil || n <= 0 {
		return nil
	}
	return unsafe.Slice((*byte)(ptr), n)
}

// Aligned reports whether a pointer can be reinterpreted as a slice of
// 8-byte values. Everything from Alloc and InputBuffer satisfies this; the
// check exists so a hand-rolled pointer from JS fails as a bad argument
// rather than as undefined behaviour.
func Aligned(ptr unsafe.Pointer) bool { return uintptr(ptr)%8 == 0 }
