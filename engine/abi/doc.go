// Package abi is what every pattern's wasm module shares at the boundary
// with JavaScript: the engine-owned scratch buffers, the input buffer,
// Alloc and Pack, the status codes, and the pointer plumbing an export
// needs to turn an (offset, length) pair into a []byte.
//
// Nothing here knows what a grid is. Each pattern keeps its own wire format
// beside its engine (the datagrid's is engine/datagrid/wire) and its own
// command under engine/cmd, built on these.
//
// Three rules every pattern's format follows:
//
//   - Little-endian, always. Wasm linear memory is little-endian and so is
//     every platform JS runs on, so there is nothing to negotiate.
//   - Lengths travel with pointers. Nothing is NUL-terminated and nothing is
//     inferred from the data.
//   - The engine owns every transfer buffer. JS writes arguments into the
//     input buffer and copies results out of the output buffers, and never
//     frees either; Alloc and Free remain only for a block that genuinely
//     needs a lifetime of its own.
package abi
