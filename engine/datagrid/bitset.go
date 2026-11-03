package datagrid

// bitset is a packed []bool: one bit per row, 64 rows to a word.
//
// A []bool would be eight times the size, and rebuildOrder scans the whole
// set after every mutation. At 200k rows that is 25 kB rather than 200 kB,
// which is the difference between living in L1 and not. In wasm it is also
// linear memory the module never hands back.
type bitset []uint64

// grow makes room for n bits. New words are zero: nothing starts deleted.
func (b *bitset) grow(n int32) {
	words := int((n + 63) >> 6)
	// Word by word, so append's doubling amortises a run of small appends
	// and no temporary slice is made for each one.
	for len(*b) < words {
		*b = append(*b, 0)
	}
}

func (b bitset) set(i int32) {
	b[i>>6] |= uint64(1) << (uint32(i) & 63)
}

func (b bitset) get(i int32) bool {
	return b[i>>6]&(uint64(1)<<(uint32(i)&63)) != 0
}
