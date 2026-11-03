package wire

import (
	"encoding/binary"
	"github.com/Kezanwar/use-wasm-state/engine/abi"
)

// DictSize is the byte size EncodeDict needs for these values.
func DictSize(values []string) int {
	size := 4 + (len(values)+1)*4
	for i := range values {
		size += len(values[i])
	}
	return size
}

// dictState is the buffer dictionary deltas are written into, with the same
// rules as the view buffer: the engine owns it, it grows and never shrinks,
// and JS copies out of it before the next dictSince call.
//
// It used to be freshly allocated per call and freed by JS. That meant a
// mounting grid allocated on the Go heap, which under this collector is
// exactly what the engine is trying not to do.
var dictState abi.Scratch

// DictCapacity is the bytes the dictionary buffer has reserved. Tests watch
// it to tell a reuse from a regrow.
func DictCapacity() int { return dictState.Capacity() }

// ResetDictBuffer drops the buffer. For tests; the module never does this.
func ResetDictBuffer() { dictState.Reset() }

// EncodeDictInto writes dictionary entries into the engine's own dictionary
// buffer and returns the bytes written.
//
// The result is valid until the next call. JS copies out of it and must
// never free it.
func EncodeDictInto(values []string) []byte {
	dst := dictState.Ensure(DictSize(values))
	EncodeDict(values, dst)
	return dst
}

// EncodeDict writes dictionary entries into dst, which must be at least
// DictSize(values) bytes.
//
// Layout: u32 count, then count+1 u32 byte offsets, then the UTF-8 blob.
// The same shape commitRows takes strings in, so JS has one encoder and
// one decoder for both directions. Offsets are relative to the start of the
// blob, not the buffer.
func EncodeDict(values []string, dst []byte) int {
	size := DictSize(values)
	binary.LittleEndian.PutUint32(dst, uint32(len(values)))

	blob := 4 + (len(values)+1)*4
	at := blob
	binary.LittleEndian.PutUint32(dst[4:], 0)
	for i := range values {
		at += copy(dst[at:], values[i])
		binary.LittleEndian.PutUint32(dst[4+(i+1)*4:], uint32(at-blob))
	}
	return size
}
