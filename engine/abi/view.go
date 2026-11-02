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

// viewState is the buffer every view is written into, plus the typed
// scratch the encoder gathers through.
//
// Scrolling a 200k-row grid is the hot path the whole design exists for, so
// after the first call of a given size it must cost no allocation at all.
// The price is that a view is only valid until the next one, which the JS
// side is told in as many words.
var viewState struct {
	out     scratch
	ids     []int32
	i32     []int32
	f64     []float64
	offsets []int
}

// ViewCapacity is the bytes the view buffer has reserved. Tests watch it to
// tell a reuse from a regrow.
func ViewCapacity() int { return viewState.out.capacity() }

// ResetViewBuffer drops the buffer. For tests; the module never does this.
func ResetViewBuffer() { viewState.out.buf = nil }

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
	clampedStart, n := t.Window(start, count)

	if cap(viewState.offsets) < len(s)+1 {
		viewState.offsets = make([]int, len(s)+1)
	}
	offs := viewState.offsets[:len(s)+1]
	size := ViewOffsets(s, n, offs)

	buf := viewState.out.ensure(size)
	binary.LittleEndian.PutUint32(buf, uint32(n))
	// The window the caller asked for may not be the one it got: a grid
	// mid-scroll asks for rows that have just stopped existing. Reporting
	// where the window actually begins is the only way JS can line the rows
	// up with its scroll position.
	binary.LittleEndian.PutUint32(buf[4:], uint32(clampedStart))

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
