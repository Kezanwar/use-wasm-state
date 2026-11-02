//go:build !tinygo.wasm && !wasm

package main

import "unsafe"

// ptrAt has no meaning outside wasm: a linear-memory offset only addresses
// anything inside the module that produced it. The native build exists so
// `go build`, `go vet` and `go test ./...` cover this package's types and
// imports; none of the exports are ever called there.
//
// It panics rather than returning nil so a build-tag mistake is loud. See
// the note in ptrwasm.go: returning nil once meant every insertColumns
// trapped on a nil slice instead of saying why.
func ptrAt(uint32) unsafe.Pointer {
	panic("engine: linear-memory offsets are only meaningful in a wasm build")
}
