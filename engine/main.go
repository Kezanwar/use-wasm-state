// Command engine is the wasm module shipped with use-wasm-state.
//
// It is the ABI and nothing else: //go:wasmexport wrappers that turn
// pointers and lengths from linear memory into Go values, hand them to
// ./table, and encode the results back out through ./abi. No table logic
// lives here, which is what keeps the engine testable as plain Go and this
// file reviewable as a contract.
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
	"github.com/Kezanwar/use-wasm-state/engine/table"
)

// One engine per module instance, and one module instance per thread. A
// shared table and a one-off table differ in which instance they live in,
// never in how they are reached.
var engine = table.NewEngine()

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
// in src/engine/input.ts.
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
/* Reading linear memory                                               */
/* ------------------------------------------------------------------ */

// bytesAt is the one piece of pointer arithmetic in the package: everything
// else works on the []byte it returns. A nil pointer or a non-positive
// length gives a nil slice rather than a trap, so a malformed call is
// rejected by the decoder instead of killing the module.
func bytesAt(ptr unsafe.Pointer, n int32) []byte {
	if ptr == nil || n <= 0 {
		return nil
	}
	return unsafe.Slice((*byte)(ptr), n)
}

// aligned reports whether a pointer can be reinterpreted as a slice of
// 8-byte values. Everything from abi.Alloc satisfies this; the check is
// here so a hand-rolled pointer from JS fails as a bad argument rather than
// as undefined behaviour.
func aligned(ptr unsafe.Pointer) bool { return uintptr(ptr)%8 == 0 }

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

//go:wasmexport createTable
func createTable(schemaPtr unsafe.Pointer, schemaLen int32) int32 {
	s, err := abi.DecodeSchema(bytesAt(schemaPtr, schemaLen))
	if err != nil {
		return abi.StatusOf(err)
	}
	h, err := engine.CreateTable(s)
	if err != nil {
		return abi.StatusOf(err)
	}
	return h
}

//go:wasmexport dropTable
func dropTable(h int32) int32 { return abi.StatusOf(engine.DropTable(h)) }

// insertColumns appends rows, one descriptor per column in schema order.
//
// The i32 and f64 columns are handed to the table as slices aliasing JS's
// own buffers rather than copied first: InsertColumns copies what it keeps,
// and the alias does not outlive this call. That saves a second copy of the
// whole dataset, which at 200k rows is megabytes of linear memory the module
// would otherwise have to grow to hold.
//
//go:wasmexport insertColumns
func insertColumns(h int32, descPtr unsafe.Pointer, colCount int32) int32 {
	t, err := engine.Table(h)
	if err != nil {
		return abi.StatusOf(err)
	}
	s := t.Schema()
	if int(colCount) != len(s) {
		return abi.StatusBadArgument
	}

	descs, err := abi.DecodeDescs(bytesAt(descPtr, colCount*abi.DescSize), colCount)
	if err != nil {
		return abi.StatusOf(err)
	}

	cols := make([]table.ColumnData, colCount)
	for i := range descs {
		d := &descs[i]
		data := ptrAt(d.DataPtr)
		if d.DataLen > 0 && !aligned(data) {
			return abi.StatusBadArgument
		}

		switch s[i].Type {
		case table.I32:
			cols[i].I32 = unsafe.Slice((*int32)(data), d.DataLen)
		case table.F64:
			cols[i].F64 = unsafe.Slice((*float64)(data), d.DataLen)
		case table.String:
			// Handed over packed rather than decoded into one Go string per
			// row. The dictionary keeps only the distinct values, so
			// building 200k strings to keep six would be 200k allocations
			// the engine immediately throws away. InsertColumns validates
			// the offsets before it reads a byte of the blob.
			offs := ptrAt(d.OffsetsPtr)
			if !aligned(offs) {
				return abi.StatusBadArgument
			}
			cols[i].Blob = bytesAt(data, int32(d.DataLen))
			cols[i].Offsets = unsafe.Slice((*int32)(offs), d.RowCount+1)
		}
	}

	first, err := t.InsertColumns(cols)
	if err != nil {
		return abi.StatusOf(err)
	}
	return first
}

/* ------------------------------------------------------------------ */
/* Edits                                                               */
/* ------------------------------------------------------------------ */

//go:wasmexport setCellI32
func setCellI32(h, row, col, v int32) int32 {
	t, err := engine.Table(h)
	if err != nil {
		return abi.StatusOf(err)
	}
	return abi.StatusOf(t.SetI32(row, col, v))
}

//go:wasmexport setCellF64
func setCellF64(h, row, col int32, v float64) int32 {
	t, err := engine.Table(h)
	if err != nil {
		return abi.StatusOf(err)
	}
	return abi.StatusOf(t.SetF64(row, col, v))
}

//go:wasmexport setCellString
func setCellString(h, row, col int32, ptr unsafe.Pointer, n int32) int32 {
	t, err := engine.Table(h)
	if err != nil {
		return abi.StatusOf(err)
	}
	if n < 0 {
		return abi.StatusBadArgument
	}
	// SetStringBytes, not SetString: a cell set to a value the column
	// already holds must not allocate, and this runs on every keystroke.
	return abi.StatusOf(t.SetStringBytes(row, col, bytesAt(ptr, n)))
}

//go:wasmexport deleteRows
func deleteRows(h int32, idsPtr unsafe.Pointer, count int32) int32 {
	t, err := engine.Table(h)
	if err != nil {
		return abi.StatusOf(err)
	}
	if count < 0 {
		return abi.StatusBadArgument
	}
	if count == 0 {
		return abi.StatusOK
	}
	if !aligned(idsPtr) {
		return abi.StatusBadArgument
	}
	return abi.StatusOf(t.DeleteRows(unsafe.Slice((*int32)(idsPtr), count)))
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
	t, err := engine.Table(h)
	if err != nil {
		return abi.StatusOf(err)
	}
	return int32(t.Revision())
}

//go:wasmexport rowCount
func rowCount(h int32) int32 {
	t, err := engine.Table(h)
	if err != nil {
		return abi.StatusOf(err)
	}
	return t.RowCount()
}

//go:wasmexport totalRows
func totalRows(h int32) int32 {
	t, err := engine.Table(h)
	if err != nil {
		return abi.StatusOf(err)
	}
	return t.TotalRows()
}

//go:wasmexport dictLen
func dictLen(h, col int32) int32 {
	t, err := engine.Table(h)
	if err != nil {
		return abi.StatusOf(err)
	}
	n, err := t.DictLen(col)
	if err != nil {
		return abi.StatusOf(err)
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
	t, err := engine.Table(h)
	if err != nil {
		return 0
	}
	b := abi.EncodeView(t, start, count)
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
	t, err := engine.Table(h)
	if err != nil {
		return 0
	}
	values, err := t.DictSince(col, from)
	if err != nil {
		return 0
	}
	b := abi.EncodeDictInto(values)
	if len(b) == 0 {
		return 0
	}
	return abi.Pack(unsafe.Pointer(&b[0]), len(b))
}
