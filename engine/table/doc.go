// Package table is the columnar store behind useWasmTable: rows, indexes,
// sort, filter, search and viewport reads.
//
// Deliberately free of any wasm-specific code so it builds and tests with
// plain `go test` (fast, and a real debugger). The wasm boundary lives one
// level up, in main.go.
//
// Empty for now; filled in build step 3.
package table
