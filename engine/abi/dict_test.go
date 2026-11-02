package abi

import (
	"encoding/binary"
	"testing"
	"unsafe"
)

// decodeDict is the Go mirror of the JS side's dictionary reader.
func decodeDict(t testing.TB, b []byte) []string {
	t.Helper()
	count := int(binary.LittleEndian.Uint32(b))
	blob := 4 + (count+1)*4

	out := make([]string, count)
	for i := 0; i < count; i++ {
		from := int(binary.LittleEndian.Uint32(b[4+i*4:]))
		to := int(binary.LittleEndian.Uint32(b[4+(i+1)*4:]))
		out[i] = string(b[blob+from : blob+to])
	}
	return out
}

func TestEncodeDict(t *testing.T) {
	cases := []struct {
		name   string
		values []string
	}{
		{"several", []string{"new", "shipped", "held"}},
		{"one", []string{"only"}},
		{"none", nil},
		{"empty strings", []string{"", "", ""}},
		{"multi-byte", []string{"caf\xc3\xa9", "na\xc3\xafve"}},
		{"long value", []string{string(make([]byte, 1000))}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			size := DictSize(tc.values)
			dst := make([]byte, size)
			if written := EncodeDict(tc.values, dst); written != size {
				t.Fatalf("EncodeDict wrote %d bytes, DictSize said %d", written, size)
			}

			got := decodeDict(t, dst)
			if len(got) != len(tc.values) {
				t.Fatalf("got %d values, want %d", len(got), len(tc.values))
			}
			for i := range got {
				if got[i] != tc.values[i] {
					t.Errorf("value %d = %q, want %q", i, got[i], tc.values[i])
				}
			}
		})
	}
}

func TestEncodeDictLayout(t *testing.T) {
	dst := make([]byte, DictSize([]string{"ab", "c"}))
	EncodeDict([]string{"ab", "c"}, dst)

	// u32 count, then count+1 u32 offsets into the blob, then the blob.
	if n := binary.LittleEndian.Uint32(dst); n != 2 {
		t.Fatalf("count = %d, want 2", n)
	}
	for i, want := range []uint32{0, 2, 3} {
		if got := binary.LittleEndian.Uint32(dst[4+i*4:]); got != want {
			t.Errorf("offset %d = %d, want %d", i, got, want)
		}
	}
	if blob := string(dst[4+3*4:]); blob != "abc" {
		t.Fatalf("blob = %q, want %q", blob, "abc")
	}
}

func TestAllocIsAlignedAndTracked(t *testing.T) {
	before := LiveBlocks()

	var ptrs []unsafe.Pointer
	for _, size := range []int32{1, 3, 8, 9, 64, 1000} {
		p := Alloc(size)
		if p == nil {
			t.Fatalf("Alloc(%d) returned nil", size)
		}
		// JS maps a Float64Array onto these, which throws if the offset is
		// not a multiple of 8.
		if uintptr(p)%8 != 0 {
			t.Errorf("Alloc(%d) returned %d, which is not 8-aligned", size, uintptr(p))
		}
		ptrs = append(ptrs, p)
	}

	if got := LiveBlocks() - before; got != len(ptrs) {
		t.Fatalf("%d live blocks, want %d", got, len(ptrs))
	}
	for _, p := range ptrs {
		Free(p)
	}
	if got := LiveBlocks(); got != before {
		t.Fatalf("%d live blocks after freeing, want %d", got, before)
	}
}

func TestAllocRejectsNonPositiveSizes(t *testing.T) {
	for _, size := range []int32{0, -1, -1000} {
		if p := Alloc(size); p != nil {
			t.Errorf("Alloc(%d) = %d, want nil", size, uintptr(p))
		}
	}
}

func TestFreeIsForgiving(t *testing.T) {
	p := Alloc(16)
	Free(p)
	// A double free, or a pointer that never came from Alloc, leaks at
	// worst. Trapping would take the whole page down over a JS bug.
	Free(p)
	Free(nil)
}

func TestPackParts(t *testing.T) {
	cases := []struct {
		off, n uint32
		want   int64
	}{
		{0, 0, 0},
		{8, 16, 8<<32 | 16},
		{1024, 0, 1024 << 32},
		// The top offset in a wasm32 address space, which must not
		// overflow into the sign bit of the result.
		{0xffffffff, 0xffffffff, int64(-1)},
	}
	for _, tc := range cases {
		if got := packParts(tc.off, tc.n); got != tc.want {
			t.Errorf("packParts(%d, %d) = %d, want %d", tc.off, tc.n, got, tc.want)
		}
	}
}

func TestPack(t *testing.T) {
	// Zero is the failure value, and it is unambiguous because offset zero
	// is never handed out by Alloc.
	if got := Pack(nil, 10); got != 0 {
		t.Errorf("Pack(nil, 10) = %d, want 0", got)
	}

	p := Alloc(32)
	defer Free(p)

	if got := Pack(p, -1); got != 0 {
		t.Errorf("Pack(ptr, -1) = %d, want 0", got)
	}

	packed := Pack(p, 32)
	if packed == 0 {
		t.Fatal("Pack returned the failure value for a good pointer")
	}
	// Only the length half is checked here: the offset half is a wasm32
	// address, and this test runs on a 64-bit host. TestPackParts covers
	// the arithmetic, and test/abi.test.ts covers it against real wasm.
	if n := packed & 0xffffffff; n != 32 {
		t.Errorf("packed length = %d, want 32", n)
	}
}
