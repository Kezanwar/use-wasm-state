package wire

import (
	"encoding/binary"
	"testing"
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

func TestEncodeDictIntoReusesOneBuffer(t *testing.T) {
	ResetDictBuffer()
	values := []string{"new", "shipped", "held"}

	first := &EncodeDictInto(values)[0]
	if second := &EncodeDictInto(values)[0]; second != first {
		t.Fatal("a second dictionary delta of the same size moved the buffer")
	}

	got := decodeDict(t, EncodeDictInto(values))
	for i := range values {
		if got[i] != values[i] {
			t.Fatalf("value %d = %q, want %q", i, got[i], values[i])
		}
	}

	// Growing for a bigger delta, then not shrinking back.
	big := make([]string, 500)
	for i := range big {
		big[i] = "a reasonably long dictionary entry"
	}
	EncodeDictInto(big)
	grown := DictCapacity()
	EncodeDictInto(values)
	if DictCapacity() != grown {
		t.Fatalf("dictionary buffer shrank to %d from %d", DictCapacity(), grown)
	}
}

func TestEncodeDictIntoOnNoValues(t *testing.T) {
	ResetDictBuffer()
	// Four bytes of count plus one offset: a mirror that is already current
	// still gets a well-formed, empty answer rather than a failure.
	b := EncodeDictInto(nil)
	if len(b) != DictSize(nil) {
		t.Fatalf("got %d bytes, want %d", len(b), DictSize(nil))
	}
	if got := decodeDict(t, b); len(got) != 0 {
		t.Fatalf("decoded %d values, want 0", len(got))
	}
}
