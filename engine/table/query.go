package table

import "math"

// A table has one query, and the row order is what the query produces:
//
//	live rows -> filters (AND) -> search -> sort
//
// It persists. Every mutation re-applies it, so a row edited into or out of
// a filter moves on its own, and an insert lands where the sort says.

// Op is a filter comparison.
type Op uint8

const (
	// OpEq and OpNe work on every column type.
	OpEq Op = iota
	OpNe
	// Numeric only.
	OpLt
	OpLe
	OpGt
	OpGe
	OpBetween
	// String only.
	OpIn
	OpContains
)

func (o Op) String() string {
	switch o {
	case OpEq:
		return "eq"
	case OpNe:
		return "ne"
	case OpLt:
		return "lt"
	case OpLe:
		return "le"
	case OpGt:
		return "gt"
	case OpGe:
		return "ge"
	case OpBetween:
		return "between"
	case OpIn:
		return "in"
	case OpContains:
		return "contains"
	}
	return "unknown"
}

func (o Op) numeric() bool { return o <= OpBetween }
func (o Op) stringy() bool { return o == OpEq || o == OpNe || o == OpIn || o == OpContains }

// SortKey is one column of a multi-column sort, in priority order.
type SortKey struct {
	Col  int32
	Desc bool
}

// Filter is one clause. Which value fields matter follows Op: Number for
// the numeric comparisons, Number and Upper for between, Text for eq, ne
// and contains on a string column, List for in.
type Filter struct {
	Col    int32
	Op     Op
	Number float64
	Upper  float64
	Text   string
	List   []string
}

// Query is the whole of what shapes the row order. The zero value is id
// order over the live rows.
type Query struct {
	Sort    []SortKey
	Filters []Filter
	Search  string
}

func (q *Query) empty() bool {
	return len(q.Sort) == 0 && len(q.Filters) == 0 && q.Search == ""
}

/* ------------------------------------------------------------------ */
/* Setting it                                                          */
/* ------------------------------------------------------------------ */

// SetQuery replaces the whole query and rebuilds the order.
//
// All or nothing: a query naming a column that does not exist, or an op a
// column cannot answer, is rejected and the previous one stays in place. A
// half-applied query would silently show the wrong rows, which is worse
// than an error.
//
// The revision moves only if the order could now differ. Setting the same
// query twice is not a change anyone has to re-render for.
func (t *Table) SetQuery(q Query) error {
	if err := t.validateQuery(&q); err != nil {
		return err
	}

	same := t.sameQuery(&q)
	t.query = t.query[:0]
	t.query = appendQuery(t.query, &q)
	t.parsed = q

	// The dictionary-derived caches describe the old query.
	t.invalidateMatches()

	if same {
		// Still rebuild: a caller setting an identical query expects the
		// order to be correct, and it costs one pass.
		t.rebuildOrder()
		return nil
	}
	t.bumpLiveness()
	return nil
}

// Query returns a copy of the current query.
func (t *Table) Query() Query {
	out := Query{Search: t.parsed.Search}
	if len(t.parsed.Sort) > 0 {
		out.Sort = append([]SortKey(nil), t.parsed.Sort...)
	}
	if len(t.parsed.Filters) > 0 {
		out.Filters = append([]Filter(nil), t.parsed.Filters...)
	}
	return out
}

func (t *Table) validateQuery(q *Query) error {
	for _, key := range q.Sort {
		if key.Col < 0 || key.Col >= int32(len(t.cols)) {
			return ErrNoSuchColumn
		}
	}
	for i := range q.Filters {
		f := &q.Filters[i]
		if f.Col < 0 || f.Col >= int32(len(t.cols)) {
			return ErrNoSuchColumn
		}
		isString := t.cols[f.Col].typ == String
		if isString && !f.Op.stringy() {
			return ErrWrongType
		}
		if !isString && !f.Op.numeric() {
			return ErrWrongType
		}
		if f.Op == OpBetween && f.Upper < f.Number {
			return ErrBadRange
		}
	}
	return nil
}

/* ------------------------------------------------------------------ */
/* Change detection                                                    */
/* ------------------------------------------------------------------ */

// The query is kept twice: as a struct for reading back, and flattened to
// bytes for comparing. Comparing structs would mean walking two slices of
// filters with a string and a string slice each; comparing the flattened
// form is one bytes.Equal, and it runs on every SetQuery.
func (t *Table) sameQuery(q *Query) bool {
	t.queryScratch = appendQuery(t.queryScratch[:0], q)
	if len(t.queryScratch) != len(t.query) {
		return false
	}
	for i := range t.query {
		if t.query[i] != t.queryScratch[i] {
			return false
		}
	}
	return true
}

func appendQuery(dst []byte, q *Query) []byte {
	for _, key := range q.Sort {
		dst = appendInt32(dst, key.Col)
		if key.Desc {
			dst = append(dst, 1)
		} else {
			dst = append(dst, 0)
		}
	}
	dst = append(dst, '|')
	for i := range q.Filters {
		f := &q.Filters[i]
		dst = appendInt32(dst, f.Col)
		dst = append(dst, byte(f.Op))
		dst = appendFloat(dst, f.Number)
		dst = appendFloat(dst, f.Upper)
		dst = append(dst, f.Text...)
		dst = append(dst, 0)
		for _, s := range f.List {
			dst = append(dst, s...)
			dst = append(dst, 0)
		}
		dst = append(dst, '|')
	}
	dst = append(dst, '|')
	return append(dst, q.Search...)
}

func appendInt32(dst []byte, v int32) []byte {
	u := uint32(v)
	return append(dst, byte(u), byte(u>>8), byte(u>>16), byte(u>>24))
}

func appendFloat(dst []byte, v float64) []byte {
	u := math.Float64bits(v)
	return append(dst,
		byte(u), byte(u>>8), byte(u>>16), byte(u>>24),
		byte(u>>32), byte(u>>40), byte(u>>48), byte(u>>56))
}

/* ------------------------------------------------------------------ */
/* What an edit can disturb                                            */
/* ------------------------------------------------------------------ */

// affectsOrder reports whether editing this column could move a row.
//
// This is the rebuild skip from build step 4b, now that there is a query to
// ask. A cell the query never looks at cannot change the order, and at 200k
// rows skipping the rebuild is the difference between an edit costing
// nothing and costing a millisecond.
func (t *Table) affectsOrder(col int32) bool {
	for _, key := range t.parsed.Sort {
		if key.Col == col {
			return true
		}
	}
	for i := range t.parsed.Filters {
		if t.parsed.Filters[i].Col == col {
			return true
		}
	}
	// Search reads every string column, so any string edit can change who
	// matches. Numeric columns are never searched.
	return t.parsed.Search != "" && t.cols[col].typ == String
}
