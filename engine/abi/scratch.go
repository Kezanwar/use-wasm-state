package abi

// scratch is a grow-only, 8-byte aligned buffer owned by the engine.
//
// Three of these exist: one for arguments coming in, one for views going
// out, one for dictionary deltas going out. Each is allocated when it first
// has to be, grown when something bigger comes along, and then reused for
// the life of the module. After the first few calls of each kind, the
// engine stops allocating for transfer altogether, which is the only way to
// stay still under a collector that has to be given nothing to do.
//
// The cost is that a buffer holds one call's data at a time. JS reads what
// it needs before making the next call of that kind, and never frees any of
// it. See "Memory model" in the architecture notes.
type scratch struct {
	buf []byte
}

// ensure returns exactly size bytes, growing if the buffer is too small.
//
// The returned slice starts on an 8-byte boundary *in linear memory*, not
// just within the buffer, because JS maps a Float64Array onto these bytes
// and that constructor throws on a misaligned offset. Go only promises
// pointer alignment, which is 4 bytes in wasm32, so the block is
// over-allocated and the start pushed up.
//
// Growing moves the buffer. Anything holding an offset into it from before
// the call is stale, which is why every caller computes the whole size
// first and asks once.
func (s *scratch) ensure(size int) []byte {
	if size <= 0 {
		return nil
	}
	if cap(s.buf) < size {
		raw := make([]byte, size+7)
		pad := alignPad(raw)
		s.buf = raw[pad : pad+size : pad+size]
	}
	return s.buf[:size]
}

// cap reports the bytes reserved, which only ever rises. Tests watch it to
// tell a reuse from a regrow.
func (s *scratch) capacity() int { return cap(s.buf) }
