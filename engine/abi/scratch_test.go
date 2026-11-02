package abi

import (
	"testing"
	"unsafe"
)

func TestScratchGrowsAndNeverShrinks(t *testing.T) {
	var s scratch

	b := s.ensure(100)
	if len(b) != 100 {
		t.Fatalf("ensure(100) gave %d bytes", len(b))
	}
	first := s.capacity()

	// A smaller ask reuses what is already there.
	if got := len(s.ensure(10)); got != 10 {
		t.Fatalf("ensure(10) gave %d bytes", got)
	}
	if s.capacity() != first {
		t.Fatalf("capacity moved to %d on a smaller ask, want %d", s.capacity(), first)
	}

	// A bigger one grows it.
	s.ensure(1000)
	if s.capacity() < 1000 {
		t.Fatalf("capacity = %d after ensure(1000)", s.capacity())
	}
	big := s.capacity()

	s.ensure(1)
	if s.capacity() != big {
		t.Fatalf("capacity shrank to %d from %d", s.capacity(), big)
	}
}

func TestScratchKeepsThePointerWhenItDoesNotGrow(t *testing.T) {
	var s scratch

	first := &s.ensure(256)[0]
	// The whole point: a view or an input written at the same size twice
	// lands at the same offset, so JS can hold on to nothing and still see
	// a stable address.
	if second := &s.ensure(256)[0]; second != first {
		t.Fatal("a second ensure of the same size moved the buffer")
	}
	if smaller := &s.ensure(128)[0]; smaller != first {
		t.Fatal("a smaller ensure moved the buffer")
	}
}

func TestScratchIsAlwaysEightByteAligned(t *testing.T) {
	var s scratch
	// Alignment has to survive every regrow, not just the first allocation:
	// JS maps a Float64Array onto these bytes.
	for _, size := range []int{1, 3, 7, 8, 9, 100, 4096, 70000} {
		b := s.ensure(size)
		if base := uintptr(unsafe.Pointer(&b[0])); base%8 != 0 {
			t.Fatalf("ensure(%d) started at %d, which is not 8-aligned", size, base)
		}
	}
}

func TestScratchRejectsNonPositiveSizes(t *testing.T) {
	var s scratch
	for _, size := range []int{0, -1} {
		if b := s.ensure(size); b != nil {
			t.Errorf("ensure(%d) gave %d bytes, want nil", size, len(b))
		}
	}
}

func TestInputBuffer(t *testing.T) {
	ResetInputBuffer()

	b := InputBuffer(64)
	if len(b) != 64 {
		t.Fatalf("InputBuffer(64) gave %d bytes", len(b))
	}
	if uintptr(unsafe.Pointer(&b[0]))%8 != 0 {
		t.Fatal("input buffer is not 8-aligned")
	}

	first := &InputBuffer(64)[0]
	if second := &InputBuffer(64)[0]; second != first {
		t.Fatal("the input buffer moved without needing to grow")
	}

	InputBuffer(100_000)
	if InputCapacity() < 100_000 {
		t.Fatalf("capacity = %d after a large ask", InputCapacity())
	}

	if b := InputBuffer(0); b != nil {
		t.Fatalf("InputBuffer(0) gave %d bytes, want nil", len(b))
	}
	if b := InputBuffer(-1); b != nil {
		t.Fatalf("InputBuffer(-1) gave %d bytes, want nil", len(b))
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
