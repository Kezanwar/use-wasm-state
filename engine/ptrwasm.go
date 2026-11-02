//go:build tinygo.wasm || wasm

package main

import "unsafe"

// ptrAt turns a linear-memory offset into a pointer.
//
// In wasm this is the identity: linear memory *is* the address space, an
// offset is an address, and the collector never moves anything. It is
// isolated in its own file because `go vet`'s unsafeptr check cannot know
// that and flags every uintptr-to-pointer conversion on sight. Splitting it
// off keeps the warning out of the native build without turning the check
// off anywhere.
//
// Two traps live in this one line, and both fail silently:
//
//   - The filename must NOT end in _wasm.go. Go reads a trailing GOOS or
//     GOARCH as an implicit build constraint, and TinyGo reports GOARCH=arm
//     for -target=wasm-unknown, so ptr_wasm.go is dropped from the build by
//     its name no matter what the //go:build line says.
//   - For the same reason the tag is tinygo.wasm, not wasm. `wasm` is kept
//     for a standard-Go GOARCH=wasm build.
//
// Get either wrong and the stub below is compiled in instead: every insert
// then traps on a nil slice, with nothing to say why. `tinygo info
// -target=wasm-unknown` prints the tags that are actually set.
func ptrAt(off uint32) unsafe.Pointer { return unsafe.Pointer(uintptr(off)) }
