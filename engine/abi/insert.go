package abi

import (
	"encoding/binary"
)

// DescSize is the byte size of one column descriptor: four u32s,
// (dataPtr, dataLen, offsetsPtr, rowCount).
const DescSize = 16

// ColumnDesc describes where one column's new rows live in linear memory.
//
// For i32 and f64 columns DataLen is an element count and OffsetsPtr is
// unused. For string columns DataLen is the byte length of one UTF-8 blob
// and OffsetsPtr points at RowCount+1 u32 byte offsets into it, so row i is
// blob[offsets[i]:offsets[i+1]].
type ColumnDesc struct {
	DataPtr    uint32
	DataLen    uint32
	OffsetsPtr uint32
	RowCount   uint32
}

// DecodeDescs reads the descriptor table insertColumns is given: n entries
// of DescSize bytes, one per column in schema order.
func DecodeDescs(b []byte, n int32) ([]ColumnDesc, error) {
	if n < 0 || len(b) < int(n)*DescSize {
		return nil, ErrBadArgument
	}
	out := make([]ColumnDesc, n)
	for i := range out {
		e := b[i*DescSize:]
		out[i] = ColumnDesc{
			DataPtr:    binary.LittleEndian.Uint32(e),
			DataLen:    binary.LittleEndian.Uint32(e[4:]),
			OffsetsPtr: binary.LittleEndian.Uint32(e[8:]),
			RowCount:   binary.LittleEndian.Uint32(e[12:]),
		}
	}
	return out, nil
}

// DecodeStrings splits one UTF-8 blob into rowCount strings using rowCount+1
// byte offsets.
//
// One blob plus offsets rather than a pointer per row: 200k rows cross as
// two buffers instead of 200k, and the strings arrive in one contiguous run
// the engine walks once. The returned strings are copies, so JS can free the
// blob as soon as this returns.
func DecodeStrings(blob, offsets []byte, rowCount int32) ([]string, error) {
	if rowCount < 0 || len(offsets) < (int(rowCount)+1)*4 {
		return nil, ErrBadArgument
	}
	if rowCount == 0 {
		return nil, nil
	}

	out := make([]string, rowCount)
	prev := binary.LittleEndian.Uint32(offsets)
	if int(prev) > len(blob) {
		return nil, ErrBadArgument
	}
	for i := int32(0); i < rowCount; i++ {
		next := binary.LittleEndian.Uint32(offsets[(i+1)*4:])
		// Offsets must run forwards and stay inside the blob. Anything else
		// is a JS bug that would otherwise read whatever is next in memory.
		if next < prev || int(next) > len(blob) {
			return nil, ErrBadArgument
		}
		out[i] = string(blob[prev:next])
		prev = next
	}
	return out, nil
}
