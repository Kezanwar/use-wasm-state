package abi

// inputState is the buffer arguments arrive in.
//
// Separate from the view and dictionary buffers on purpose: JS fills this
// one and then calls an export that reads it, and those exports may write a
// view on the way out. One shared buffer would have the reply overwrite the
// request.
var inputState scratch

// InputBuffer returns a buffer of at least minBytes for JS to write
// arguments into, growing it if needed and never shrinking it.
//
// This is what replaces an alloc/free pair around every call. The engine
// runs under a collector that must be given as little as possible to do, so
// a grid that edits a cell sixty times a second cannot be minting a block
// each time. The buffer is the engine's for the life of the module; JS
// writes into it, calls an export, and never frees it.
//
// Contents live until the next InputBuffer call. Growing moves it, so a
// caller works out everything one operation needs, asks once, and only then
// starts writing: an offset taken before a grow points into the old block.
func InputBuffer(minBytes int32) []byte {
	return inputState.ensure(int(minBytes))
}

// InputCapacity is the bytes the input buffer has reserved. Tests watch it
// to tell a reuse from a regrow.
func InputCapacity() int { return inputState.capacity() }

// ResetInputBuffer drops the buffer. For tests; the module never does this.
func ResetInputBuffer() { inputState.buf = nil }
