// Package datagrid is the columnar store behind use-wasm-state/datagrid.
//
// An Engine holds many grids by handle. A grid is created from an ordered
// schema and stores each column as one flat slice: []int32 for i32, []float64
// for f64, and []int32 dictionary ids for strings. Row ids are positions in
// those slices and never move, so React can use them as keys; a delete writes
// a tombstone rather than shifting millions of elements.
//
// What crosses to JS is a viewport, not a grid. Sort, filter and search only
// rebuild a []int32 of live row ids in display order, and View reads one
// window of that order. Every mutation bumps a revision counter, which is what
// useSyncExternalStore subscribes to.
//
// There is deliberately no wasm in here: no //go:wasmexport, no unsafe, no
// pointers. That keeps the engine testable with plain `go test` and a real
// debugger. Its wire format is ./wire, and the wasm boundary is
// engine/cmd/datagrid.
//
// It must also compile under TinyGo for -target=wasm-unknown, which rules out
// reflection, encoding/json and fmt.
package datagrid
