package wire

import (
	"encoding/binary"
	"errors"
	"github.com/Kezanwar/use-wasm-state/engine/abi"
	"testing"

	"github.com/Kezanwar/use-wasm-state/engine/datagrid"
)

func sampleSchema() datagrid.Schema {
	return datagrid.Schema{
		{Name: "id", Type: datagrid.I32},
		{Name: "price", Type: datagrid.F64},
		{Name: "status", Type: datagrid.String},
	}
}

func TestSchemaRoundTrip(t *testing.T) {
	cases := []struct {
		name   string
		schema datagrid.Schema
	}{
		{"one of each type", sampleSchema()},
		{"single column", datagrid.Schema{{Name: "n", Type: datagrid.I32}}},
		{"empty name", datagrid.Schema{{Name: "", Type: datagrid.F64}}},
		{
			"multi-byte name",
			datagrid.Schema{{Name: "pris", Type: datagrid.F64}, {Name: "naim", Type: datagrid.String}},
		},
		{"no columns", datagrid.Schema{}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := DecodeSchema(EncodeSchema(tc.schema))
			if err != nil {
				t.Fatalf("DecodeSchema: %v", err)
			}
			if len(got) != len(tc.schema) {
				t.Fatalf("got %d columns, want %d", len(got), len(tc.schema))
			}
			for i := range got {
				if got[i] != tc.schema[i] {
					t.Errorf("column %d = %+v, want %+v", i, got[i], tc.schema[i])
				}
			}
		})
	}
}

func TestDecodeSchemaLayout(t *testing.T) {
	// Spelled out byte by byte rather than round-tripped: this is the format
	// src/datagrid/abi.ts encodes independently, so the bytes themselves are
	// the contract.
	b := []byte{
		2, 0, 0, 0, // u32 columnCount
		0,          // u8 type: i32
		2, 0, 0, 0, // u32 nameByteLen
		'i', 'd',
		2,          // u8 type: string
		3, 0, 0, 0, // u32 nameByteLen
		'a', 'b', 'c',
	}

	s, err := DecodeSchema(b)
	if err != nil {
		t.Fatalf("DecodeSchema: %v", err)
	}
	want := datagrid.Schema{
		{Name: "id", Type: datagrid.I32},
		{Name: "abc", Type: datagrid.String},
	}
	for i := range want {
		if s[i] != want[i] {
			t.Errorf("column %d = %+v, want %+v", i, s[i], want[i])
		}
	}
}

func TestDecodeSchemaRejects(t *testing.T) {
	good := EncodeSchema(sampleSchema())

	cases := []struct {
		name string
		b    []byte
	}{
		{"nil", nil},
		{"shorter than the count", []byte{0, 0}},
		{"truncated mid column", good[:len(good)-4]},
		{"count larger than the buffer could hold", []byte{255, 255, 255, 255}},
		{"name length past the end", func() []byte {
			b := append([]byte(nil), good...)
			binary.LittleEndian.PutUint32(b[5:], 9999)
			return b
		}()},
		{"unknown type byte", func() []byte {
			b := append([]byte(nil), good...)
			b[4] = 7
			return b
		}()},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := DecodeSchema(tc.b); !errors.Is(err, ErrBadSchema) {
				t.Fatalf("DecodeSchema = %v, want ErrBadSchema", err)
			}
			if got := StatusOf(decodeErr(tc.b)); got != abi.StatusBadSchema {
				t.Fatalf("status = %d, want %d", got, abi.StatusBadSchema)
			}
		})
	}
}
