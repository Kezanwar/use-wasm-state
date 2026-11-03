package abi

import "errors"

// Status codes. Every export that can fail returns one of these as a
// negative int32, which is why no export has a meaningful negative result:
// a handle, a row id and a count are all non-negative.
//
// Shared by every pattern's engine. The same numbers are mirrored in
// src/datagrid/abi.ts, and named in src/core/errors.ts.
const (
	StatusOK          int32 = 0
	StatusBadHandle   int32 = -1
	StatusOutOfRange  int32 = -2
	StatusRowDeleted  int32 = -3
	StatusWrongType   int32 = -4
	StatusRowCount    int32 = -5
	StatusBadSchema   int32 = -6
	StatusBadArgument int32 = -7
)

// ErrBadArgument means an argument did not describe what it claimed: a
// short buffer, a negative length, a misaligned pointer, or string offsets
// that do not run forwards to the end of the blob.
var ErrBadArgument = errors.New("abi: bad argument")
