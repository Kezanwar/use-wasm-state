package abi

import "encoding/binary"

// DictSize is the byte size EncodeDict needs for these values.
func DictSize(values []string) int {
	size := 4 + (len(values)+1)*4
	for i := range values {
		size += len(values[i])
	}
	return size
}

// EncodeDict writes dictionary entries into dst, which must be at least
// DictSize(values) bytes.
//
// Layout: u32 count, then count+1 u32 byte offsets, then the UTF-8 blob.
// The same shape insertColumns takes strings in, so JS has one encoder and
// one decoder for both directions. Offsets are relative to the start of the
// blob, not the buffer.
//
// Unlike a view, this is freshly allocated by the caller and handed to JS to
// free: a dictionary delta is read once and thrown away, where a view is
// read sixty times a second.
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
