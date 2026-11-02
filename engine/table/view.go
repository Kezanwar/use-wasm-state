package table

// ViewColumn is one column's slice of a viewport.
//
// Exactly one of I32 and F64 is set. A string column reports dictionary ids
// in I32, which is what crosses to JS: the ids are small and fixed-width,
// and JS resolves them against the mirror it builds from DictSince.
type ViewColumn struct {
	Type ColumnType
	I32  []int32
	F64  []float64
}

// View is one window of the current row order.
type View struct {
	// Start is the offset the window actually begins at, after clamping.
	Start int32
	// RowIDs are the ids of the rows in the window, in display order. They
	// are React's keys, and they are what SetCell and DeleteRows take.
	RowIDs []int32
	// Cols has one entry per schema column, in schema order, each the same
	// length as RowIDs.
	Cols []ViewColumn
}

// View returns the rows at order[start:start+count].
//
// The whole point of the design: a 200k-row table answers a scroll by
// copying out the fifty rows on screen. Sort, filter and search change the
// order rather than the data, so they cost nothing here.
//
// Windows are clamped, never rejected. A grid asking for rows past the end
// mid-scroll, or for a window of a table that just shrank, is ordinary, so
// an out-of-range request returns the overlap it can and an empty view when
// there is none. Cols always has one entry per column even when empty, so
// callers can index it without checking.
//
// The returned slices are fresh copies and the caller owns them.
func (t *Table) View(start, count int32) View {
	n := int32(len(t.order))

	if start < 0 {
		start = 0
	}
	if count < 0 {
		count = 0
	}
	if start > n {
		start = n
	}
	if start+count > n {
		count = n - start
	}

	ids := make([]int32, count)
	copy(ids, t.order[start:start+count])

	cols := make([]ViewColumn, len(t.cols))
	for i := range t.cols {
		c := &t.cols[i]
		cols[i].Type = c.typ
		switch c.typ {
		case F64:
			out := make([]float64, count)
			for j, id := range ids {
				out[j] = c.f64[id]
			}
			cols[i].F64 = out
		default:
			// I32 values, or String dictionary ids: both are []int32.
			out := make([]int32, count)
			for j, id := range ids {
				out[j] = c.i32[id]
			}
			cols[i].I32 = out
		}
	}

	return View{Start: start, RowIDs: ids, Cols: cols}
}

// DictLen is the current number of entries in a string column's dictionary,
// which is the `from` a caller passes to the next DictSince.
func (t *Table) DictLen(col int32) (int32, error) {
	c, err := t.columnOf(col, String)
	if err != nil {
		return 0, err
	}
	return c.dict.len(), nil
}

// DictSince returns the dictionary entries added at or after index `from`.
//
// Dictionaries are append-only, so JS mirrors one by remembering how many
// entries it has and asking for the rest. An insert of 200k rows over fifty
// distinct labels sends fifty strings once, and every later frame sends ids.
//
// `from` is clamped: past the end returns nothing rather than an error,
// which is what a mirror that is already current should see.
//
// The result aliases the dictionary and is valid until the next mutation.
// Copy it if you need to keep it.
func (t *Table) DictSince(col, from int32) ([]string, error) {
	c, err := t.columnOf(col, String)
	if err != nil {
		return nil, err
	}
	if from < 0 {
		from = 0
	}
	if from >= c.dict.len() {
		return nil, nil
	}
	return c.dict.values[from:], nil
}
