package abi

import (
	"encoding/binary"
	"errors"
	"testing"

	"github.com/Kezanwar/use-wasm-state/engine/table"
)

func sampleSchema() table.Schema {
	return table.Schema{
		{Name: "id", Type: table.I32},
		{Name: "price", Type: table.F64},
		{Name: "status", Type: table.String},
	}
}

func TestSchemaRoundTrip(t *testing.T) {
	cases := []struct {
		name   string
		schema table.Schema
	}{
		{"one of each type", sampleSchema()},
		{"single column", table.Schema{{Name: "n", Type: table.I32}}},
		{"empty name", table.Schema{{Name: "", Type: table.F64}}},
		{
			"multi-byte name",
			table.Schema{{Name: "pris", Type: table.F64}, {Name: "naim", Type: table.String}},
		},
		{"no columns", table.Schema{}},
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
	// src/engine/abi.ts encodes independently, so the bytes themselves are
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
	want := table.Schema{
		{Name: "id", Type: table.I32},
		{Name: "abc", Type: table.String},
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
			if got := StatusOf(decodeErr(tc.b)); got != StatusBadSchema {
				t.Fatalf("status = %d, want %d", got, StatusBadSchema)
			}
		})
	}
}

// decodeErr lets the table above assert the status mapping as well as the
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
		{"nil", nil, StatusOK},
		{"bad handle", table.ErrNoSuchTable, StatusBadHandle},
		{"bad row", table.ErrNoSuchRow, StatusOutOfRange},
		{"bad column", table.ErrNoSuchColumn, StatusOutOfRange},
		{"deleted row", table.ErrRowDeleted, StatusRowDeleted},
		{"wrong type", table.ErrWrongType, StatusWrongType},
		{"ragged rows", table.ErrRowCount, StatusRowCount},
		{"empty schema", table.ErrEmptySchema, StatusBadSchema},
		{"duplicate column", table.ErrDuplicateColumn, StatusBadSchema},
		{"malformed schema", ErrBadSchema, StatusBadSchema},
		{"bad argument", ErrBadArgument, StatusBadArgument},
		// Not a row-count mismatch: the caller passed the wrong number of
		// descriptors, which is a malformed call.
		{"wrong column count", table.ErrColumnCount, StatusBadArgument},
		{"anything else", errors.New("boom"), StatusBadArgument},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := StatusOf(tc.err); got != tc.want {
				t.Fatalf("StatusOf(%v) = %d, want %d", tc.err, got, tc.want)
			}
		})
	}
}

// Every status code must be distinct, or JS cannot tell two failures apart.
func TestStatusCodesAreDistinct(t *testing.T) {
	seen := map[int32]bool{}
	for _, s := range []int32{
		StatusOK, StatusBadHandle, StatusOutOfRange, StatusRowDeleted,
		StatusWrongType, StatusRowCount, StatusBadSchema, StatusBadArgument,
	} {
		if seen[s] {
			t.Fatalf("status %d is used twice", s)
		}
		seen[s] = true
	}
	if len(seen) != 8 {
		t.Fatalf("got %d distinct statuses, want 8", len(seen))
	}
}
