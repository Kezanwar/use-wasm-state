package table

// Filtering and searching both work the same way on string columns: decide
// once, per dictionary entry, whether it matches, then scan the rows
// comparing integers. A column of 200k rows over six labels asks the
// question six times.
//
// Numeric columns have nothing to cache; the comparison is already the
// cheapest thing available.

// invalidateMatches drops the per-dictionary match sets, so the next
// rebuild recomputes them. Called when the query changes; growth of a
// dictionary is caught by the stamp on each set.
func (t *Table) invalidateMatches() {
	for i := range t.filterMatch {
		t.filterMatch[i].valid = false
	}
	for i := range t.searchMatch {
		t.searchMatch[i].valid = false
	}
}

// matchSet is which dictionary entries of one column satisfy something,
// plus the dictionary length it was built for.
type matchSet struct {
	bits  bitset
	for_  int32
	valid bool
}

func (m *matchSet) reset(n int32) {
	m.bits = m.bits[:0]
	m.bits.grow(n)
	for i := range m.bits {
		m.bits[i] = 0
	}
	m.for_ = n
	m.valid = true
}

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

// ensureFilterMatches rebuilds any string filter's match set that is out of
// date, either because the query changed or the dictionary grew.
func (t *Table) ensureFilterMatches() {
	for len(t.filterMatch) < len(t.parsed.Filters) {
		t.filterMatch = append(t.filterMatch, matchSet{})
	}

	for i := range t.parsed.Filters {
		f := &t.parsed.Filters[i]
		c := &t.cols[f.Col]
		if c.typ != String {
			continue
		}

		set := &t.filterMatch[i]
		n := c.dict.len()
		if set.valid && set.for_ == n {
			continue
		}
		set.reset(n)

		switch f.Op {
		case OpEq, OpNe:
			// ne is eq inverted at read time, so both build the same set.
			if id, ok := c.dict.lookup(f.Text); ok {
				set.bits.set(id)
			}
		case OpIn:
			for _, want := range f.List {
				if id, ok := c.dict.lookup(want); ok {
					set.bits.set(id)
				}
			}
		case OpContains:
			needle := lowerASCII(f.Text)
			if needle == "" {
				for id := int32(0); id < n; id++ {
					set.bits.set(id)
				}
				continue
			}
			for id := int32(0); id < n; id++ {
				if containsASCII(c.dict.lower[id], needle) {
					set.bits.set(id)
				}
			}
		}
	}
}

// passesFilters is the per-row half: integer comparisons only.
func (t *Table) passesFilters(id int32) bool {
	for i := range t.parsed.Filters {
		f := &t.parsed.Filters[i]
		c := &t.cols[f.Col]

		if c.typ == String {
			hit := t.filterMatch[i].bits.get(c.i32[id])
			if f.Op == OpNe {
				hit = !hit
			}
			if !hit {
				return false
			}
			continue
		}

		var v float64
		if c.typ == F64 {
			v = c.f64[id]
		} else {
			v = float64(c.i32[id])
		}

		ok := false
		switch f.Op {
		case OpEq:
			ok = v == f.Number
		case OpNe:
			ok = v != f.Number
		case OpLt:
			ok = v < f.Number
		case OpLe:
			ok = v <= f.Number
		case OpGt:
			ok = v > f.Number
		case OpGe:
			ok = v >= f.Number
		case OpBetween:
			ok = v >= f.Number && v <= f.Upper
		}
		if !ok {
			return false
		}
	}
	return true
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

// ensureSearchMatches builds, per string column, which dictionary entries
// contain the search text.
func (t *Table) ensureSearchMatches() {
	if t.parsed.Search == "" {
		return
	}
	for len(t.searchMatch) < len(t.cols) {
		t.searchMatch = append(t.searchMatch, matchSet{})
	}

	needle := lowerASCII(t.parsed.Search)
	for i := range t.cols {
		c := &t.cols[i]
		if c.typ != String {
			continue
		}

		set := &t.searchMatch[i]
		n := c.dict.len()
		if set.valid && set.for_ == n {
			continue
		}
		set.reset(n)

		for id := int32(0); id < n; id++ {
			if containsASCII(c.dict.lower[id], needle) {
				set.bits.set(id)
			}
		}
	}
}

// matchesSearch is true when any string column of the row contains the
// text. A table with no string columns matches nothing, which is the
// honest answer rather than everything.
func (t *Table) matchesSearch(id int32) bool {
	for i := range t.cols {
		c := &t.cols[i]
		if c.typ != String {
			continue
		}
		if t.searchMatch[i].bits.get(c.i32[id]) {
			return true
		}
	}
	return false
}

/* ------------------------------------------------------------------ */
/* Case folding                                                        */
/* ------------------------------------------------------------------ */

// lowerASCII folds A-Z only.
//
// Deliberately not unicode.ToLower: it pulls Go's case tables into the
// module for kilobytes, and the columns this is for hold identifiers,
// statuses and names. A non-ASCII letter still matches itself; it just
// does not match its own other case.
func lowerASCII(s string) string {
	upper := false
	for i := 0; i < len(s); i++ {
		if s[i] >= 'A' && s[i] <= 'Z' {
			upper = true
			break
		}
	}
	if !upper {
		return s
	}

	out := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		b := s[i]
		if b >= 'A' && b <= 'Z' {
			b += 32
		}
		out[i] = b
	}
	return string(out)
}

// containsASCII is strings.Contains without the import.
func containsASCII(haystack, needle string) bool {
	if len(needle) == 0 {
		return true
	}
	if len(needle) > len(haystack) {
		return false
	}
	first := needle[0]
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i] != first {
			continue
		}
		matched := true
		for j := 1; j < len(needle); j++ {
			if haystack[i+j] != needle[j] {
				matched = false
				break
			}
		}
		if matched {
			return true
		}
	}
	return false
}
