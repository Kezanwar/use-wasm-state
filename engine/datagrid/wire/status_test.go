package wire

import (
	"errors"
	"testing"

	"github.com/Kezanwar/use-wasm-state/engine/abi"
	"github.com/Kezanwar/use-wasm-state/engine/datagrid"
)

// decodeErr lets the grid above assert the status mapping as well as the
// sentinel.
func decodeErr(b []byte) error {
	_, e := DecodeSchema(b)
	return e
}

func TestStatusOf(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want int32
	}{
		{"nil", nil, abi.StatusOK},
		{"bad handle", datagrid.ErrNoSuchGrid, abi.StatusBadHandle},
		{"bad row", datagrid.ErrNoSuchRow, abi.StatusOutOfRange},
		{"bad column", datagrid.ErrNoSuchColumn, abi.StatusOutOfRange},
		{"deleted row", datagrid.ErrRowDeleted, abi.StatusRowDeleted},
		{"wrong type", datagrid.ErrWrongType, abi.StatusWrongType},
		{"ragged rows", datagrid.ErrRowCount, abi.StatusRowCount},
		{"empty schema", datagrid.ErrEmptySchema, abi.StatusBadSchema},
		{"duplicate column", datagrid.ErrDuplicateColumn, abi.StatusBadSchema},
		{"malformed schema", ErrBadSchema, abi.StatusBadSchema},
		{"bad argument", abi.ErrBadArgument, abi.StatusBadArgument},
		// Not a row-count mismatch: the caller passed the wrong number of
		// descriptors, which is a malformed call.
		{"wrong column count", datagrid.ErrColumnCount, abi.StatusBadArgument},
		{"anything else", errors.New("boom"), abi.StatusBadArgument},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := StatusOf(tc.err); got != tc.want {
				t.Fatalf("StatusOf(%v) = %d, want %d", tc.err, got, tc.want)
			}
		})
	}
}
