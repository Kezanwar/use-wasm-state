package abi

import (
	"encoding/binary"

	"github.com/Kezanwar/use-wasm-state/engine/table"
)

// Column type bytes on the wire. They are their own constants rather than a
// cast of table.ColumnType so that reordering the Go enum cannot silently
// change the format JS already speaks.
const (
	WireI32    byte = 0
	WireF64    byte = 1
	WireString byte = 2
)

// DecodeSchema reads the schema bytes createTable is given.
//
// Layout, packed and little-endian:
//
//	u32 columnCount
//	per column: u8 type, u32 nameByteLen, name UTF-8 bytes
//
// Names are copied, so the caller's buffer can be freed as soon as this
// returns.
func DecodeSchema(b []byte) (table.Schema, error) {
	if len(b) < 4 {
		return nil, ErrBadSchema
	}
	n := binary.LittleEndian.Uint32(b)
	// Each column costs at least five bytes, so a count that could not fit
	// is rejected before it is used as a capacity.
	if uint64(n)*5 > uint64(len(b)-4) {
		return nil, ErrBadSchema
	}

	s := make(table.Schema, n)
	off := 4
	for i := uint32(0); i < n; i++ {
		if off+5 > len(b) {
			return nil, ErrBadSchema
		}
		typ, err := columnType(b[off])
		if err != nil {
			return nil, err
		}
		nameLen := int(binary.LittleEndian.Uint32(b[off+1:]))
		off += 5
		if nameLen < 0 || off+nameLen > len(b) {
			return nil, ErrBadSchema
		}
		s[i] = table.Column{Name: string(b[off : off+nameLen]), Type: typ}
		off += nameLen
	}
	return s, nil
}

func columnType(wire byte) (table.ColumnType, error) {
	switch wire {
	case WireI32:
		return table.I32, nil
	case WireF64:
		return table.F64, nil
	case WireString:
		return table.String, nil
	}
	return 0, ErrBadSchema
}

// EncodeSchema is DecodeSchema's inverse. Only the Go tests use it; JS has
// its own encodeSchema in src/engine/abi.ts, and the two agreeing is what
// test/abi.test.ts checks.
func EncodeSchema(s table.Schema) []byte {
	size := 4
	for i := range s {
		size += 5 + len(s[i].Name)
	}

	b := make([]byte, size)
	binary.LittleEndian.PutUint32(b, uint32(len(s)))
	off := 4
	for i := range s {
		switch s[i].Type {
		case table.I32:
			b[off] = WireI32
		case table.F64:
			b[off] = WireF64
		case table.String:
			b[off] = WireString
		}
		binary.LittleEndian.PutUint32(b[off+1:], uint32(len(s[i].Name)))
		off += 5
		off += copy(b[off:], s[i].Name)
	}
	return b
}
