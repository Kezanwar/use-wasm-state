package datagrid

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
// The whole point of the design: a 200k-row grid answers a scroll by
// copying out the fifty rows on screen. Sort, filter and search change the
// order rather than the data, so they cost nothing here.
//
// Windows are clamped, never rejected. A grid asking for rows past the end
// mid-scroll, or for a window of a grid that just shrank, is ordinary, so
// an out-of-range request returns the overlap it can and an empty view when
// there is none. Cols always has one entry per column even when empty, so
// callers can index it without checking.
//
// The returned slices are fresh copies and the caller owns them.
func (t *Grid) View(start, count int32) View {
	start, count = t.Window(start, count)

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
func (t *Grid) DictLen(col int32) (int32, error) {
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
func (t *Grid) DictSince(col, from int32) ([]string, error) {
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

/* ------------------------------------------------------------------ */
/* The allocation-free path                                            */
/* ------------------------------------------------------------------ */

// Window clamps a requested window to the live rows and returns the offset
// it actually starts at and how many rows it covers.
//
// Exported because the ABI has to size its buffer before it reads anything,
// and because clamping is the contract: a grid mid-scroll asks for rows that
// may have just stopped existing.
func (t *Grid) Window(start, count int32) (int32, int32) {
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
	return start, count
}

// ViewInto copies the window's row ids into dst and returns how many it
// wrote, which is min(len(dst), the clamped window).
//
// The same read as View, without the allocation. View is the comfortable
// API; this is what the ABI uses sixty times a second, where a fresh slice
// per frame is a fresh slice per frame.
func (t *Grid) ViewInto(start, count int32, dst []int32) int32 {
	start, count = t.Window(start, count)
	if int32(len(dst)) < count {
		count = int32(len(dst))
	}
	copy(dst[:count], t.order[start:start+count])
	return count
}

// GatherI32 copies one i32 column's values for the given row ids into dst.
// A string column is gathered the same way and yields its dictionary ids.
//
// ids come from ViewInto, so they are live row ids and need no bounds check
// here beyond dst being long enough.
func (t *Grid) GatherI32(col int32, ids []int32, dst []int32) error {
	c, err := t.columnOf(col, I32)
	if err != nil {
		// A string column stores dictionary ids in the same []int32, and
		// the wire format sends them as ints, so it is gathered here too.
		var strErr error
		c, strErr = t.columnOf(col, String)
		if strErr != nil {
			return err
		}
	}
	if len(dst) < len(ids) {
		return ErrRowCount
	}
	src := c.i32
	for i, id := range ids {
		dst[i] = src[id]
	}
	return nil
}

// GatherF64 copies one f64 column's values for the given row ids into dst.
func (t *Grid) GatherF64(col int32, ids []int32, dst []float64) error {
	c, err := t.columnOf(col, F64)
	if err != nil {
		return err
	}
	if len(dst) < len(ids) {
		return ErrRowCount
	}
	src := c.f64
	for i, id := range ids {
		dst[i] = src[id]
	}
	return nil
}
