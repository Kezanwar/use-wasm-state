package abi

import (
	"errors"

	"github.com/Kezanwar/use-wasm-state/engine/table"
)

// Status codes. Every export that can fail returns one of these as a
// negative int32, which is why no export has a meaningful negative result:
// a handle, a row id and a count are all non-negative.
//
// The same numbers are mirrored in src/engine/abi.ts.
const (
	StatusOK          int32 = 0
	StatusBadHandle   int32 = -1
	StatusOutOfRange  int32 = -2
	StatusRowDeleted  int32 = -3
	StatusWrongType   int32 = -4
	StatusRowCount    int32 = -5
	StatusBadSchema   int32 = -6
	StatusBadArgument int32 = -7
)

// Decoding failures, raised by this package rather than by the table.
var (
	// ErrBadSchema means the schema bytes are malformed: truncated, or a
	// column type byte that is not 0, 1 or 2.
	ErrBadSchema = errors.New("abi: malformed schema")
	// ErrBadArgument means an argument did not describe what it claimed:
	// a short buffer, a negative length, a misaligned pointer, or string
	// offsets that do not run forwards to the end of the blob.
	ErrBadArgument = errors.New("abi: bad argument")
)

// StatusOf is the single place an error becomes a status code. Every export
// returns StatusOf(err) rather than deciding for itself, so JS sees one
// consistent mapping.
//
// table.ErrColumnCount lands on StatusBadArgument rather than
// StatusRowCount: the caller passed the wrong number of column descriptors,
// which is a malformed call, not a disagreement between columns about how
// many rows they carry.
func StatusOf(err error) int32 {
	switch {
	case err == nil:
		return StatusOK
	case errors.Is(err, table.ErrNoSuchTable):
		return StatusBadHandle
	case errors.Is(err, table.ErrNoSuchRow), errors.Is(err, table.ErrNoSuchColumn):
		return StatusOutOfRange
	case errors.Is(err, table.ErrRowDeleted):
		return StatusRowDeleted
	case errors.Is(err, table.ErrWrongType):
		return StatusWrongType
	case errors.Is(err, table.ErrRowCount):
		return StatusRowCount
	case errors.Is(err, ErrBadSchema),
		errors.Is(err, table.ErrEmptySchema),
		errors.Is(err, table.ErrDuplicateColumn):
		return StatusBadSchema
	default:
		return StatusBadArgument
	}
}
