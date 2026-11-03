package wire

import (
	"encoding/binary"
	"errors"
	"github.com/Kezanwar/use-wasm-state/engine/abi"
	"testing"
)

func TestDecodeDescs(t *testing.T) {
	b := make([]byte, 2*DescSize)
	for i, v := range []uint32{100, 50, 0, 50, 200, 24, 300, 5} {
		binary.LittleEndian.PutUint32(b[i*4:], v)
	}

	got, err := DecodeDescs(b, 2)
	if err != nil {
		t.Fatalf("DecodeDescs: %v", err)
	}
	want := []ColumnDesc{
		{DataPtr: 100, DataLen: 50, OffsetsPtr: 0, RowCount: 50},
		{DataPtr: 200, DataLen: 24, OffsetsPtr: 300, RowCount: 5},
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("desc %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestDecodeDescsRejects(t *testing.T) {
	cases := []struct {
		name string
		b    []byte
		n    int32
	}{
		{"negative count", make([]byte, DescSize), -1},
		{"buffer too short", make([]byte, DescSize-1), 1},
		{"nil buffer with a count", nil, 1},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := DecodeDescs(tc.b, tc.n); !errors.Is(err, abi.ErrBadArgument) {
				t.Fatalf("DecodeDescs = %v, want abi.ErrBadArgument", err)
			}
		})
	}
}
