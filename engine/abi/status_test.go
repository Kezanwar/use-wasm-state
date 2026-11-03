package abi

import "testing"

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
