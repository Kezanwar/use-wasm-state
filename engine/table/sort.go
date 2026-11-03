package table

import (
	"math"
	"slices"
)

// Sorting is done on unsigned keys, not on the values.
//
// One key per row per sort column, encoded so that comparing the keys as
// unsigned integers gives the same answer as comparing the values. That
// buys two things: a radix sort becomes possible, and a descending sort is
// the same pass with the key inverted.
//
// Multi-column is least-significant-first: sort by the last key, then the
// one before it, and so on. Every pass is stable, so earlier passes survive
// as the tie-break. Ties all the way down keep the input order, which is
// row id order, which is why nothing has to compare ids explicitly.

/** sortMode picks the implementation. Benchmarked in sort_test.go. */
type sortMode uint8

const (
	// sortRadix is the default: see BenchmarkSort* for why.
	sortRadix sortMode = iota
	sortCompare
)

// f64Key maps a float64 onto a uint64 that sorts the same way.
//
// Floats already sort correctly as signed-magnitude integers within a
// sign; flipping the sign bit for positives and every bit for negatives
// makes the two halves line up. NaN has no order and lands at one end.
func f64Key(v float64) uint64 {
	u := math.Float64bits(v)
	if u&(1<<63) != 0 {
		return ^u
	}
	return u | (1 << 63)
}

// i32Key is the same trick for a signed integer: flip the sign bit.
func i32Key(v int32) uint64 { return uint64(uint32(v) ^ 0x80000000) }

/* ------------------------------------------------------------------ */
/* The string rank cache                                               */
/* ------------------------------------------------------------------ */

// ensureRank gives every dictionary entry its position in the dictionary
// sorted by value, so a string column sorts as integers like the others.
//
// Ordered case-insensitively, with byte order breaking ties, because a
// column of names sorted by byte would put every capitalised entry above
// every lowercase one and read as broken. The fold is free here: the
// dictionary already keeps a lowercase mirror.
//
// Built once per column and rebuilt only when the dictionary has grown,
// which is what makes sorting a 200k-row string column cost one pass over
// the rows rather than 200k string comparisons.
func (c *column) ensureRank() {
	n := c.dict.len()
	if c.rankFor == n && c.rank != nil {
		return
	}

	if int32(cap(c.rankOrder)) < n {
		c.rankOrder = make([]int32, n)
		c.rank = make([]int32, n)
	}
	c.rankOrder = c.rankOrder[:n]
	c.rank = c.rank[:n]

	values, lower := c.dict.values, c.dict.lower
	for i := int32(0); i < n; i++ {
		c.rankOrder[i] = i
	}
	// A comparison sort, but over distinct values rather than rows: a
	// status column is six entries against two hundred thousand.
	slices.SortFunc(c.rankOrder, func(a, b int32) int {
		if folded := compareStrings(lower[a], lower[b]); folded != 0 {
			return folded
		}
		return compareStrings(values[a], values[b])
	})
	for position, id := range c.rankOrder {
		c.rank[id] = int32(position)
	}
	c.rankFor = n
}

// compareStrings is strings.Compare without the import. Byte order, which
// for UTF-8 is code point order.
func compareStrings(a, b string) int {
	n := len(a)
	if len(b) < n {
		n = len(b)
	}
	for i := 0; i < n; i++ {
		if a[i] != b[i] {
			if a[i] < b[i] {
				return -1
			}
			return 1
		}
	}
	switch {
	case len(a) < len(b):
		return -1
	case len(a) > len(b):
		return 1
	}
	return 0
}

/* ------------------------------------------------------------------ */
/* Applying a sort                                                     */
/* ------------------------------------------------------------------ */

// applySort reorders `order` in place, or into the table's scratch and
// back. Returns the sorted slice, which is always `order`.
func (t *Table) applySort(order []int32) {
	if len(order) < 2 || len(t.parsed.Sort) == 0 {
		return
	}

	if t.sortMode == sortCompare {
		t.sortByComparison(order)
		return
	}

	for k := len(t.parsed.Sort) - 1; k >= 0; k-- {
		t.fillKeys(order, t.parsed.Sort[k])
		t.radixPass(order)
	}
}

func (t *Table) fillKeys(order []int32, key SortKey) {
	c := &t.cols[key.Col]
	if int32(cap(t.sortKeys)) < int32(len(order)) {
		t.sortKeys = make([]uint64, len(order))
		t.sortKeysScratch = make([]uint64, len(order))
		t.orderScratch = make([]int32, len(order))
	}
	keys := t.sortKeys[:len(order)]

	switch c.typ {
	case F64:
		src := c.f64
		for i, id := range order {
			keys[i] = f64Key(src[id])
		}
	case String:
		c.ensureRank()
		rank, src := c.rank, c.i32
		for i, id := range order {
			keys[i] = uint64(uint32(rank[src[id]]))
		}
	default:
		src := c.i32
		for i, id := range order {
			keys[i] = i32Key(src[id])
		}
	}

	if key.Desc {
		for i := range keys {
			keys[i] = ^keys[i]
		}
	}
}

// radixPass is one stable LSD radix sort over the current keys.
//
// Eight bits at a time, skipping any byte that is identical across every
// key. That skip is what makes a 32-bit key cost four passes instead of
// eight, and a column of small integers fewer still, without needing a
// separate code path per width.
func (t *Table) radixPass(order []int32) {
	n := len(order)
	keys := t.sortKeys[:n]

	var ones, zeros uint64
	zeros = ^uint64(0)
	for _, k := range keys {
		ones |= k
		zeros &= k
	}
	varying := ones ^ zeros
	if varying == 0 {
		return
	}

	src, dst := order, t.orderScratch[:n]
	srcKeys, dstKeys := keys, t.sortKeysScratch[:n]
	swapped := false

	var counts [256]int32
	for shift := uint(0); shift < 64; shift += 8 {
		if (varying>>shift)&0xff == 0 {
			continue
		}

		counts = [256]int32{}
		for _, k := range srcKeys {
			counts[(k>>shift)&0xff]++
		}
		running := int32(0)
		for b := 0; b < 256; b++ {
			c := counts[b]
			counts[b] = running
			running += c
		}
		for i, k := range srcKeys {
			b := (k >> shift) & 0xff
			at := counts[b]
			counts[b]++
			dst[at] = src[i]
			dstKeys[at] = k
		}

		src, dst = dst, src
		srcKeys, dstKeys = dstKeys, srcKeys
		swapped = !swapped
	}

	// An odd number of passes leaves the answer in the scratch.
	if swapped {
		copy(order, src)
		copy(t.sortKeys[:n], srcKeys)
	}
}

// sortByComparison is the obvious implementation, kept so the benchmark
// has something to beat and so a bug in the radix sort has a reference.
func (t *Table) sortByComparison(order []int32) {
	keys := t.parsed.Sort
	slices.SortStableFunc(order, func(a, b int32) int {
		for _, key := range keys {
			if c := t.compareOn(key, a, b); c != 0 {
				return c
			}
		}
		return int(a - b)
	})
}

func (t *Table) compareOn(key SortKey, a, b int32) int {
	c := &t.cols[key.Col]
	var result int

	switch c.typ {
	case F64:
		x, y := c.f64[a], c.f64[b]
		switch {
		case x < y:
			result = -1
		case x > y:
			result = 1
		}
	case String:
		c.ensureRank()
		result = int(c.rank[c.i32[a]] - c.rank[c.i32[b]])
	default:
		result = int(c.i32[a] - c.i32[b])
	}

	if key.Desc {
		return -result
	}
	return result
}
