package wire

import (
	"encoding/binary"
	"github.com/Kezanwar/use-wasm-state/engine/abi"
)

// DescSize is the byte size of one column descriptor: four u32s,
// (dataPtr, dataLen, offsetsPtr, rowCount).
const DescSize = 16

// ColumnDesc is one column's entry in what commitRows is given.
//
// Every column is written in place by then, a string column's as
// dictionary ids, and a numeric column's entry is zeros. A string column's
// carries the RowCount strings new to its dictionary, in the order the ids
// past its end name them: DataLen is the byte length of one UTF-8 blob at
// DataPtr, and OffsetsPtr points at RowCount+1 u32 byte offsets into it, so
// string i is blob[offsets[i]:offsets[i+1]].
type ColumnDesc struct {
	DataPtr    uint32
	DataLen    uint32
	OffsetsPtr uint32
	RowCount   uint32
}

// DecodeDescs reads the descriptors commitRows is given, n entries of
// DescSize bytes, one per column in schema order, into dst's storage, so
// a caller that keeps dst decodes without allocating.
func DecodeDescs(dst []ColumnDesc, b []byte, n int32) ([]ColumnDesc, error) {
	if n < 0 || len(b) < int(n)*DescSize {
		return dst, abi.ErrBadArgument
	}
	out := dst[:0]
	for len(out) < int(n) {
		out = append(out, ColumnDesc{})
	}
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
