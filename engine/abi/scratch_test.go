package abi

import (
	"testing"
	"unsafe"
)

func TestScratchGrowsAndNeverShrinks(t *testing.T) {
	var s Scratch

	b := s.Ensure(100)
	if len(b) != 100 {
		t.Fatalf("ensure(100) gave %d bytes", len(b))
	}
	first := s.Capacity()

	// A smaller ask reuses what is already there.
	if got := len(s.Ensure(10)); got != 10 {
		t.Fatalf("ensure(10) gave %d bytes", got)
	}
	if s.Capacity() != first {
		t.Fatalf("capacity moved to %d on a smaller ask, want %d", s.Capacity(), first)
	}

	// A bigger one grows it.
	s.Ensure(1000)
	if s.Capacity() < 1000 {
		t.Fatalf("capacity = %d after ensure(1000)", s.Capacity())
	}
	big := s.Capacity()

	s.Ensure(1)
	if s.Capacity() != big {
		t.Fatalf("capacity shrank to %d from %d", s.Capacity(), big)
	}
}

func TestScratchKeepsThePointerWhenItDoesNotGrow(t *testing.T) {
	var s Scratch

	first := &s.Ensure(256)[0]
	// The whole point: a view or an input written at the same size twice
	// lands at the same offset, so JS can hold on to nothing and still see
	// a stable address.
	if second := &s.Ensure(256)[0]; second != first {
		t.Fatal("a second ensure of the same size moved the buffer")
	}
	if smaller := &s.Ensure(128)[0]; smaller != first {
		t.Fatal("a smaller ensure moved the buffer")
	}
}

func TestScratchIsAlwaysEightByteAligned(t *testing.T) {
	var s Scratch
	// Alignment has to survive every regrow, not just the first allocation:
	// JS maps a Float64Array onto these bytes.
	for _, size := range []int{1, 3, 7, 8, 9, 100, 4096, 70000} {
		b := s.Ensure(size)
		if base := uintptr(unsafe.Pointer(&b[0])); base%8 != 0 {
			t.Fatalf("ensure(%d) started at %d, which is not 8-aligned", size, base)
		}
	}
}

func TestScratchRejectsNonPositiveSizes(t *testing.T) {
	var s Scratch
	for _, size := range []int{0, -1} {
		if b := s.Ensure(size); b != nil {
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
