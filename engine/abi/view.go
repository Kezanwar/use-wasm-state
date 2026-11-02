package abi

import (
	"encoding/binary"
	"math"

	"github.com/Kezanwar/use-wasm-state/engine/table"
)

// ViewHeaderSize is the fixed header at the top of a view buffer: u32 row
// count, u32 reserved. The reserved word is padding that makes the first
// section land on an 8-byte boundary; it is not spare space to grow into.
const ViewHeaderSize = 8

// ViewOffsets computes where each section of a view buffer starts and
// returns the total size.
//
// dst receives one offset per section: the row ids first, then one per
// column in schema order. It must have room for 1+len(s) entries. Passing
// your own slice is what keeps the encoder allocation-free.
//
// Every section starts on an 8-byte boundary, padded if the one before it
// ended mid-word, so JS can map a Float64Array straight onto a column
// instead of copying it out byte by byte.
func ViewOffsets(s table.Schema, n int32, dst []int) int {
	off := ViewHeaderSize

	dst[0] = off
	off += int(n) * 4

	for i := range s {
		off = alignUp(off)
		dst[i+1] = off
		if s[i].Type == table.F64 {
			off += int(n) * 8
		} else {
			off += int(n) * 4
		}
	}
	return off
}

// viewState is the single buffer every view is written into, plus the
// scratch the encoder reuses.
//
// One buffer for the life of the module, grown and never shrunk. Scrolling a
// 200k-row grid is the hot path the whole design exists for, and it has to
// cost no allocation at all; the price is that a view is only valid until
// the next one, which the JS side is told in as many words.
var viewState struct {
	buf     []byte
	ids     []int32
	i32     []int32
	f64     []float64
	offsets []int
}

// ViewBuffer returns the current buffer, for tests that want to watch it
// grow or stay put.
func ViewBuffer() []byte { return viewState.buf }

// ResetViewBuffer drops the buffer. For tests; the module never does this.
func ResetViewBuffer() { viewState.buf = nil }

// EncodeView writes one window of a table into the shared buffer and returns
// the bytes written.
//
// The result aliases the buffer and is only valid until the next EncodeView.
// JS copies out of it and must never free it.
//
// Layout: the header, the row ids, then each column in schema order, every
// section 8-byte aligned. A string column reports dictionary ids, which JS
// resolves against the mirror it builds from dictSince.
func EncodeView(t *table.Table, start, count int32) []byte {
	s := t.Schema()
	_, n := t.Window(start, count)

	if cap(viewState.offsets) < len(s)+1 {
		viewState.offsets = make([]int, len(s)+1)
	}
	offs := viewState.offsets[:len(s)+1]
	size := ViewOffsets(s, n, offs)

	buf := growAligned(&viewState.buf, size)
	binary.LittleEndian.PutUint32(buf, uint32(n))
	binary.LittleEndian.PutUint32(buf[4:], 0)

	if cap(viewState.ids) < int(n) {
		viewState.ids = make([]int32, n)
	}
	ids := viewState.ids[:n]
	t.ViewInto(start, count, ids)

	at := offs[0]
	for i, id := range ids {
		binary.LittleEndian.PutUint32(buf[at+i*4:], uint32(id))
	}

	for c := range s {
		at := offs[c+1]
		if s[c].Type == table.F64 {
			if cap(viewState.f64) < int(n) {
				viewState.f64 = make([]float64, n)
			}
			vals := viewState.f64[:n]
			if err := t.GatherF64(int32(c), ids, vals); err != nil {
				continue
			}
			for i, v := range vals {
				binary.LittleEndian.PutUint64(buf[at+i*8:], math.Float64bits(v))
			}
			continue
		}

		if cap(viewState.i32) < int(n) {
			viewState.i32 = make([]int32, n)
		}
		vals := viewState.i32[:n]
		if err := t.GatherI32(int32(c), ids, vals); err != nil {
			continue
		}
		for i, v := range vals {
			binary.LittleEndian.PutUint32(buf[at+i*4:], uint32(v))
		}
	}

	return buf
}

// growAligned returns a slice of exactly size bytes whose first byte sits on
// an 8-byte boundary, reusing *b when it is already big enough.
//
// Alignment has to hold for the address in linear memory, not just the
// offset inside the buffer, because JS indexes Float64Array off
// memory.buffer itself. Go only guarantees pointer alignment, so the block
// is over-allocated and the start pushed up.
func growAligned(b *[]byte, size int) []byte {
	if cap(*b) >= size {
		return (*b)[:size]
	}
	raw := make([]byte, size+7)
	pad := alignPad(raw)
	*b = raw[pad : pad+size : pad+size]
	return *b
}
