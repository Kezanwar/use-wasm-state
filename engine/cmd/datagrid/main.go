// Command datagrid is datagrid.wasm, the engine use-wasm-state/datagrid
// ships.
//
// It is the ABI and nothing else: //go:wasmexport wrappers that turn
// pointers and lengths from linear memory into Go values, hand them to
// engine/datagrid, and encode the results back out through
// engine/datagrid/wire. No grid logic lives here, which is what keeps the
// engine testable as plain Go and this file reviewable as a contract. A
// second pattern gets a command of its own beside this one, sharing
// engine/abi.
//
// Every export returns an int32 status, or a non-negative result where a
// negative value is a status (see abi.Status*). The two that return buffers
// return a packed (offset, length) int64, zero on failure.
//
// Built with TinyGo for -target=wasm-unknown, which has no WASI runtime: the
// module imports nothing at all and reaches the host only by being called.
// scripts/inspect-wasm.mjs enforces that, and the exact export list, after
// every build.
package main

import (
	"unsafe"

	"github.com/Kezanwar/use-wasm-state/engine/abi"
	"github.com/Kezanwar/use-wasm-state/engine/datagrid"
	"github.com/Kezanwar/use-wasm-state/engine/datagrid/wire"
)

// One engine per module instance, and one module instance per thread. A
// shared grid and a one-off grid differ in which instance they live in,
// never in how they are reached.
var engine = datagrid.NewEngine()

// TinyGo needs a main for a `package main`, but wasm-unknown never calls it.
// The module is a reactor: the host runs _initialize, then calls exports.
func main() {}

/* ------------------------------------------------------------------ */
/* Memory                                                              */
/* ------------------------------------------------------------------ */

// inputBuffer hands back the engine's own argument buffer, grown to at
// least minBytes and 8-byte aligned.
//
// This is how arguments get in. An alloc/free pair around every call would
// put a block on the Go heap sixty times a second, and the collector this
// module ships with has to be given as little as possible to do. The buffer
// belongs to the engine: JS writes into it, calls an export, and never
// frees it.
//
// Contents live until the next inputBuffer call. Growing moves it, so a
// caller sizes everything one operation needs and asks once. See withInput
// in src/core/wasm/input.ts.
//
//go:wasmexport inputBuffer
func inputBuffer(minBytes int32) unsafe.Pointer {
	b := abi.InputBuffer(minBytes)
	if len(b) == 0 {
		return nil
	}
	return unsafe.Pointer(&b[0])
}

// alloc and free remain for callers that genuinely need a block of their
// own with its own lifetime. Nothing in this package's own TypeScript uses
// them per operation; inputBuffer is that path.
//
//go:wasmexport alloc
func alloc(size int32) unsafe.Pointer { return abi.Alloc(size) }

//go:wasmexport free
func free(ptr unsafe.Pointer) { abi.Free(ptr) }

/* ------------------------------------------------------------------ */
/* Grids                                                              */
/* ------------------------------------------------------------------ */

//go:wasmexport createGrid
func createGrid(schemaPtr unsafe.Pointer, schemaLen int32) int32 {
	s, err := wire.DecodeSchema(abi.BytesAt(schemaPtr, schemaLen))
	if err != nil {
		return wire.StatusOf(err)
	}
	h, err := engine.CreateGrid(s)
	if err != nil {
		return wire.StatusOf(err)
	}
	return h
}

//go:wasmexport dropGrid
func dropGrid(h int32) int32 { return wire.StatusOf(engine.DropGrid(h)) }

// insertColumns appends rows, one descriptor per column in schema order.
//
// The i32 and f64 columns are handed to the grid as slices aliasing JS's
// own buffers rather than copied first: InsertColumns copies what it keeps,
// and the alias does not outlive this call. That saves a second copy of the
// whole dataset, which at 200k rows is megabytes of linear memory the module
// would otherwise have to grow to hold.
//
//go:wasmexport insertColumns
func insertColumns(h int32, descPtr unsafe.Pointer, colCount int32) int32 {
	t, err := engine.Grid(h)
	if err != nil {
		return wire.StatusOf(err)
	}
	s := t.Schema()
	if int(colCount) != len(s) {
		return abi.StatusBadArgument
	}

	descs, err := wire.DecodeDescs(abi.BytesAt(descPtr, colCount*wire.DescSize), colCount)
	if err != nil {
		return wire.StatusOf(err)
	}

	cols := make([]datagrid.ColumnData, colCount)
	for i := range descs {
		d := &descs[i]
		data := abi.PtrAt(d.DataPtr)
		if d.DataLen > 0 && !abi.Aligned(data) {
			return abi.StatusBadArgument
		}

		switch s[i].Type {
		case datagrid.I32:
			cols[i].I32 = unsafe.Slice((*int32)(data), d.DataLen)
		case datagrid.F64:
			cols[i].F64 = unsafe.Slice((*float64)(data), d.DataLen)
		case datagrid.String:
			// Handed over packed rather than decoded into one Go string per
			// row. The dictionary keeps only the distinct values, so
			// building 200k strings to keep six would be 200k allocations
			// the engine immediately throws away. InsertColumns validates
			// the offsets before it reads a byte of the blob.
			offs := abi.PtrAt(d.OffsetsPtr)
			if !abi.Aligned(offs) {
				return abi.StatusBadArgument
			}
			cols[i].Blob = abi.BytesAt(data, int32(d.DataLen))
			cols[i].Offsets = unsafe.Slice((*int32)(offs), d.RowCount+1)
		}
	}

	first, err := t.InsertColumns(cols)
	if err != nil {
		return wire.StatusOf(err)
	}
	return first
}

/* ------------------------------------------------------------------ */
/* Edits                                                               */
/* ------------------------------------------------------------------ */

//go:wasmexport setCellI32
func setCellI32(h, row, col, v int32) int32 {
	t, err := engine.Grid(h)
	if err != nil {
		return wire.StatusOf(err)
	}
	return wire.StatusOf(t.SetI32(row, col, v))
}

//go:wasmexport setCellF64
func setCellF64(h, row, col int32, v float64) int32 {
	t, err := engine.Grid(h)
	if err != nil {
		return wire.StatusOf(err)
	}
	return wire.StatusOf(t.SetF64(row, col, v))
}

//go:wasmexport setCellString
func setCellString(h, row, col int32, ptr unsafe.Pointer, n int32) int32 {
	t, err := engine.Grid(h)
	if err != nil {
		return wire.StatusOf(err)
	}
	if n < 0 {
		return abi.StatusBadArgument
	}
	// SetStringBytes, not SetString: a cell set to a value the column
	// already holds must not allocate, and this runs on every keystroke.
	return wire.StatusOf(t.SetStringBytes(row, col, abi.BytesAt(ptr, n)))
}

// setQuery replaces the grid's sort, filters and search in one call.
//
// One call because it is one thing: applying half a query would show the
// wrong rows. A rejected query leaves the previous one in place, and the
// revision moves only if the resulting order could differ.
//
//go:wasmexport setQuery
func setQuery(h int32, ptr unsafe.Pointer, n int32) int32 {
	t, err := engine.Grid(h)
	if err != nil {
		return wire.StatusOf(err)
	}
	if n < 0 {
		return abi.StatusBadArgument
	}
	q, err := wire.DecodeQuery(abi.BytesAt(ptr, n))
	if err != nil {
		return wire.StatusOf(err)
	}
	return wire.StatusOf(t.SetQuery(q))
}

//go:wasmexport deleteRows
func deleteRows(h int32, idsPtr unsafe.Pointer, count int32) int32 {
	t, err := engine.Grid(h)
	if err != nil {
		return wire.StatusOf(err)
	}
	if count < 0 {
		return abi.StatusBadArgument
	}
	if count == 0 {
		return abi.StatusOK
	}
	if !abi.Aligned(idsPtr) {
		return abi.StatusBadArgument
	}
	return wire.StatusOf(t.DeleteRows(unsafe.Slice((*int32)(idsPtr), count)))
}

/* ------------------------------------------------------------------ */
/* Scalar reads                                                        */
/* ------------------------------------------------------------------ */

// revision wraps rather than saturates, and JS reads it with >>> 0. A
// counter that only has to differ from its previous value does not need a
// range.
//
//go:wasmexport revision
func revision(h int32) int32 {
	t, err := engine.Grid(h)
	if err != nil {
		return wire.StatusOf(err)
	}
	return int32(t.Revision())
}

//go:wasmexport rowCount
func rowCount(h int32) int32 {
	t, err := engine.Grid(h)
	if err != nil {
		return wire.StatusOf(err)
	}
	return t.RowCount()
}

//go:wasmexport totalRows
func totalRows(h int32) int32 {
	t, err := engine.Grid(h)
	if err != nil {
		return wire.StatusOf(err)
	}
	return t.TotalRows()
}

//go:wasmexport dictLen
func dictLen(h, col int32) int32 {
	t, err := engine.Grid(h)
	if err != nil {
		return wire.StatusOf(err)
	}
	n, err := t.DictLen(col)
	if err != nil {
		return wire.StatusOf(err)
	}
	return n
}

/* ------------------------------------------------------------------ */
/* Buffer reads                                                        */
/* ------------------------------------------------------------------ */

// view returns a packed (offset, length) pointing into a buffer the engine
// owns and reuses. JS must copy out of it before the next view call, and
// must never free it.
//
//go:wasmexport view
func view(h, start, count int32) int64 {
	t, err := engine.Grid(h)
	if err != nil {
		return 0
	}
	b := wire.EncodeView(t, start, count)
	if len(b) == 0 {
		return 0
	}
	return abi.Pack(unsafe.Pointer(&b[0]), len(b))
}

// dictSince returns a packed (offset, length) into a buffer the engine owns
// and reuses, holding the dictionary entries added since `from`.
//
// Same rules as view: copy out of it before the next dictSince call, and
// never free it.
//
//go:wasmexport dictSince
func dictSince(h, col, from int32) int64 {
	t, err := engine.Grid(h)
	if err != nil {
		return 0
	}
	values, err := t.DictSince(col, from)
	if err != nil {
		return 0
	}
	b := wire.EncodeDictInto(values)
	if len(b) == 0 {
		return 0
	}
	return abi.Pack(unsafe.Pointer(&b[0]), len(b))
}
