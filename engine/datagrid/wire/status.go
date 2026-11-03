package wire

import (
	"errors"

	"github.com/Kezanwar/use-wasm-state/engine/abi"
	"github.com/Kezanwar/use-wasm-state/engine/datagrid"
)

// ErrBadSchema means the schema bytes are malformed: truncated, or a
// column type byte that is not 0, 1 or 2.
var ErrBadSchema = errors.New("wire: malformed schema")

// StatusOf is the single place an error becomes a status code. Every export
// returns StatusOf(err) rather than deciding for itself, so JS sees one
// consistent mapping.
//
// datagrid.ErrColumnCount lands on abi.StatusBadArgument rather than
// abi.StatusRowCount: the caller passed the wrong number of column descriptors,
// which is a malformed call, not a disagreement between columns about how
// many rows they carry.
func StatusOf(err error) int32 {
	switch {
	case err == nil:
		return abi.StatusOK
	case errors.Is(err, datagrid.ErrNoSuchGrid):
		return abi.StatusBadHandle
	case errors.Is(err, datagrid.ErrNoSuchRow), errors.Is(err, datagrid.ErrNoSuchColumn):
		return abi.StatusOutOfRange
	case errors.Is(err, datagrid.ErrRowDeleted):
		return abi.StatusRowDeleted
	case errors.Is(err, datagrid.ErrWrongType):
		return abi.StatusWrongType
	case errors.Is(err, datagrid.ErrRowCount):
		return abi.StatusRowCount
	case errors.Is(err, ErrBadSchema),
		errors.Is(err, datagrid.ErrEmptySchema),
		errors.Is(err, datagrid.ErrDuplicateColumn):
		return abi.StatusBadSchema
	default:
		return abi.StatusBadArgument
	}
}
