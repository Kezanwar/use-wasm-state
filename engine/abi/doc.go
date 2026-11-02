// Package abi is the wire format between JavaScript and the table engine.
//
// Everything here works on plain []byte and Go values, so it is testable
// with `go test` and carries no wasm-specific code beyond the allocator. The
// pointer arithmetic lives one level up in main.go, which turns an (offset,
// length) pair from linear memory into a []byte and hands it to a function
// in here.
//
// Three rules the whole format follows:
//
//   - Little-endian, always. Wasm linear memory is little-endian and so is
//     every platform JS runs on, so there is nothing to negotiate.
//   - Lengths travel with pointers. Nothing is NUL-terminated and nothing is
//     inferred from the data.
//   - Who allocates says who frees. JS allocates and frees the buffers it
//     fills for insertColumns; the engine allocates what it returns from
//     dictSince and JS frees that; the view buffer belongs to the engine for
//     its whole life and JS must never free it.
package abi
