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
