package abi

import (
	"encoding/binary"
	"errors"
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
			if _, err := DecodeDescs(tc.b, tc.n); !errors.Is(err, ErrBadArgument) {
				t.Fatalf("DecodeDescs = %v, want ErrBadArgument", err)
			}
		})
	}
}

// offsetsFor builds the offset table that accompanies a string blob.
func offsetsFor(lengths ...int) []byte {
	b := make([]byte, (len(lengths)+1)*4)
	at := 0
	for i, n := range lengths {
		at += n
		binary.LittleEndian.PutUint32(b[(i+1)*4:], uint32(at))
	}
	return b
}

func TestDecodeStrings(t *testing.T) {
	cases := []struct {
		name    string
		blob    string
		lengths []int
		want    []string
	}{
		{"three rows", "abbccc", []int{1, 2, 3}, []string{"a", "bb", "ccc"}},
		{"empty strings between values", "ab", []int{1, 0, 1}, []string{"a", "", "b"}},
		{"all empty", "", []int{0, 0}, []string{"", ""}},
		// "h\xc3\xa9" is three bytes for two characters: the offsets are byte
		// offsets, and sizing them from character counts would split the
		// encoding in half.
		{"multi-byte", "h\xc3\xa9llo", []int{3, 3}, []string{"h\xc3\xa9", "llo"}},
		{"no rows", "", nil, nil},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := DecodeStrings([]byte(tc.blob), offsetsFor(tc.lengths...), int32(len(tc.lengths)))
			if err != nil {
				t.Fatalf("DecodeStrings: %v", err)
			}
			if len(got) != len(tc.want) {
				t.Fatalf("got %d strings, want %d", len(got), len(tc.want))
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("row %d = %q, want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestDecodeStringsCopies(t *testing.T) {
	blob := []byte("abc")
	got, err := DecodeStrings(blob, offsetsFor(3), 1)
	if err != nil {
		t.Fatalf("DecodeStrings: %v", err)
	}

	// JS frees the blob as soon as insertColumns returns, so the strings
	// must not alias it.
	blob[0] = 'z'
	if got[0] != "abc" {
		t.Fatalf("string aliased the blob: %q", got[0])
	}
}

func TestDecodeStringsRejects(t *testing.T) {
	cases := []struct {
		name     string
		blob     []byte
		offsets  []byte
		rowCount int32
	}{
		{"negative row count", []byte("ab"), offsetsFor(1, 1), -1},
		{"offsets too short", []byte("ab"), make([]byte, 4), 2},
		{"last offset past the blob", []byte("ab"), offsetsFor(99), 1},
		{"first offset past the blob", []byte("ab"), func() []byte {
			b := offsetsFor(1)
			binary.LittleEndian.PutUint32(b, 99)
			return b
		}(), 1},
		{"offsets run backwards", []byte("abcd"), func() []byte {
			b := offsetsFor(3, 1)
			binary.LittleEndian.PutUint32(b[4:], 3)
			binary.LittleEndian.PutUint32(b[8:], 1)
			return b
		}(), 2},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := DecodeStrings(tc.blob, tc.offsets, tc.rowCount); !errors.Is(err, ErrBadArgument) {
				t.Fatalf("DecodeStrings = %v, want ErrBadArgument", err)
			}
		})
	}
}
