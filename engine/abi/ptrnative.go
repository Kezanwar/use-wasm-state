//go:build !tinygo.wasm && !wasm

package abi

import "unsafe"

// PtrAt has no meaning outside wasm: a linear-memory offset only addresses
// anything inside the module that produced it. The native build exists so
// `go build`, `go vet` and `go test ./...` cover every package that
// imports this; none of the exports are ever called there.
//
// It panics rather than returning nil so a build-tag mistake is loud. See
// the note in ptrwasm.go: returning nil once meant every insert
// trapped on a nil slice instead of saying why.
func PtrAt(uint32) unsafe.Pointer {
	panic("abi: linear-memory offsets are only meaningful in a wasm build")
}
