package table

// column is one column's storage. Which slice is live follows typ; the other
// is nil. A string column keeps its dictionary ids in i32, because that is
// exactly what View hands back and what crosses to JS.
type column struct {
	typ  ColumnType
	i32  []int32   // I32 values, or String dictionary ids
	f64  []float64 // F64 values
	dict dictionary
}

// orderSpec is the stored sort/filter/search state.
//
// Empty in v1, on purpose. rebuildOrder already runs at the end of every
// mutation and already reads this field, so step 7 adds sorting by filling
// the struct in rather than by threading a new call through every mutation.
type orderSpec struct{}

// Table is a columnar store with stable row ids.
//
// Not safe for concurrent use. One table belongs to one engine instance,
// which belongs to one thread: the main thread or one worker.
type Table struct {
	schema Schema
	cols   []column

	// rows counts every row ever appended, tombstones included, so it is
	// also the exclusive upper bound on a valid row id.
	rows int32
	// deleted marks tombstoned rows. Column data is never shifted, which is
	// what keeps row ids stable.
	deleted bitset

	// order is the live row ids in display order: what View reads through
	// and what RowCount measures. Rebuilt, never patched.
	order []int32
	spec  orderSpec

	revision uint32
}

// ColumnData carries one column's worth of new rows for InsertColumns.
// Exactly one field is set, matching that column's type. Strings arrive as
// strings here and are interned on the way in; the caller never sees an id.
type ColumnData struct {
	I32     []int32
	F64     []float64
	Strings []string
}

func newTable(s Schema) *Table {
	t := &Table{schema: s.clone()}
	t.cols = make([]column, len(t.schema))
	for i := range t.schema {
		t.cols[i].typ = t.schema[i].Type
	}
	return t
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

// Revision is bumped once by every mutation that changes anything. It is the
// whole of the reactivity contract: useSyncExternalStore reads this and
// nothing else.
func (t *Table) Revision() uint32 { return t.revision }

// RowCount is the number of live rows, which is the length of the current
// order. Tombstoned rows are not counted.
func (t *Table) RowCount() int32 { return int32(len(t.order)) }

// TotalRows counts every row ever appended, tombstones included. It is the
// exclusive upper bound on a valid row id, not something to render.
func (t *Table) TotalRows() int32 { return t.rows }

// Schema returns the table's columns in order. Treat it as read-only: it
// backs the table's own storage layout.
func (t *Table) Schema() Schema { return t.schema }

// IsDeleted reports whether a valid row id has been tombstoned.
func (t *Table) IsDeleted(rowID int32) (bool, error) {
	if rowID < 0 || rowID >= t.rows {
		return false, ErrNoSuchRow
	}
	return t.deleted.get(rowID), nil
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

// liveRow rejects a row id that was never issued, or that has been deleted.
// Both are mistakes a caller should hear about rather than have papered over.
func (t *Table) liveRow(rowID int32) error {
	if rowID < 0 || rowID >= t.rows {
		return ErrNoSuchRow
	}
	if t.deleted.get(rowID) {
		return ErrRowDeleted
	}
	return nil
}

func (t *Table) columnOf(col int32, want ColumnType) (*column, error) {
	if col < 0 || col >= int32(len(t.cols)) {
		return nil, ErrNoSuchColumn
	}
	c := &t.cols[col]
	if c.typ != want {
		return nil, ErrWrongType
	}
	return c, nil
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

// InsertColumns appends rows, one slice per column in schema order, and
// returns the id of the first row appended.
//
// One call for the whole batch on purpose: the cost that matters is crossing
// the wasm boundary, so 200k rows arrive as a handful of buffers rather than
// 200k calls. Nothing is written until every column has been checked, so a
// rejected insert leaves the table exactly as it was.
//
// Appending zero rows succeeds and does not bump the revision: there is
// nothing for a subscriber to re-render.
func (t *Table) InsertColumns(data []ColumnData) (firstRowID int32, err error) {
	if len(data) != len(t.cols) {
		return 0, ErrColumnCount
	}

	n := columnLen(&data[0], t.cols[0].typ)
	for i := range t.cols {
		if columnLen(&data[i], t.cols[i].typ) != n {
			return 0, ErrRowCount
		}
	}
	if n == 0 {
		return t.rows, nil
	}

	first := t.rows
	for i := range t.cols {
		c := &t.cols[i]
		switch c.typ {
		case I32:
			c.i32 = append(c.i32, data[i].I32...)
		case F64:
			c.f64 = append(c.f64, data[i].F64...)
		case String:
			// Interning is the expensive part of a large insert: one map
			// lookup per cell. It buys a column that is four bytes a row
			// however long the strings are, and a dictionary JS fetches
			// once instead of a string per cell per frame.
			src := data[i].Strings
			ids := c.i32
			if cap(ids)-len(ids) < len(src) {
				grown := make([]int32, len(ids), len(ids)+len(src))
				copy(grown, ids)
				ids = grown
			}
			for j := range src {
				ids = append(ids, c.dict.intern(src[j]))
			}
			c.i32 = ids
		}
	}

	t.rows += n
	t.deleted.grow(t.rows)
	t.bump()
	return first, nil
}

// columnLen is how many rows a ColumnData carries for a column of this type.
// A caller who fills the wrong field reads as length zero and is caught by
// the row-count check.
func columnLen(d *ColumnData, typ ColumnType) int32 {
	switch typ {
	case I32:
		return int32(len(d.I32))
	case F64:
		return int32(len(d.F64))
	case String:
		return int32(len(d.Strings))
	}
	return 0
}

// SetI32 writes one cell of an i32 column.
func (t *Table) SetI32(rowID, col int32, v int32) error {
	if err := t.liveRow(rowID); err != nil {
		return err
	}
	c, err := t.columnOf(col, I32)
	if err != nil {
		return err
	}
	c.i32[rowID] = v
	t.bump()
	return nil
}

// SetF64 writes one cell of an f64 column.
func (t *Table) SetF64(rowID, col int32, v float64) error {
	if err := t.liveRow(rowID); err != nil {
		return err
	}
	c, err := t.columnOf(col, F64)
	if err != nil {
		return err
	}
	c.f64[rowID] = v
	t.bump()
	return nil
}

// SetString writes one cell of a string column, interning the value.
//
// A value the column has not held before appends to its dictionary, so JS
// has to pick up the new entry (DictSince) before it can render the cell.
func (t *Table) SetString(rowID, col int32, v string) error {
	if err := t.liveRow(rowID); err != nil {
		return err
	}
	c, err := t.columnOf(col, String)
	if err != nil {
		return err
	}
	c.i32[rowID] = c.dict.intern(v)
	t.bump()
	return nil
}

// DeleteRows tombstones rows. Column data is left where it is, so every
// surviving row keeps its id.
//
// All or nothing: if any id is unknown or already deleted the table is
// untouched and the revision does not move. Repeating an id inside one batch
// is harmless, since liveness is judged against the state on entry.
//
// Deleting zero rows succeeds and does not bump the revision.
func (t *Table) DeleteRows(rowIDs []int32) error {
	for _, id := range rowIDs {
		if err := t.liveRow(id); err != nil {
			return err
		}
	}
	if len(rowIDs) == 0 {
		return nil
	}
	for _, id := range rowIDs {
		t.deleted.set(id)
	}
	t.bump()
	return nil
}

/* ------------------------------------------------------------------ */
/* Order                                                               */
/* ------------------------------------------------------------------ */

// bump ends every successful mutation: advance the revision, then rebuild
// the order the new revision describes.
func (t *Table) bump() {
	t.revision++
	t.rebuildOrder()
}

// rebuildOrder recomputes the live row ids in display order.
//
// v1 is every live row in id order. The order is rebuilt rather than patched
// because step 7 makes it the output of the sort/filter/search spec, where an
// edit to one cell can move a row anywhere. That costs O(rows) per mutation,
// including a single SetCell; at 200k rows it is well inside a frame, and the
// alternative is a patch path that step 7 would have to throw away.
func (t *Table) rebuildOrder() {
	order := t.order[:0]
	for w := 0; w < len(t.deleted); w++ {
		base := int32(w) << 6
		end := base + 64
		if end > t.rows {
			end = t.rows
		}
		bits := t.deleted[w]
		if bits == 0 {
			// No tombstones in these 64 rows, which is the common case and
			// worth skipping the per-row test for.
			for id := base; id < end; id++ {
				order = append(order, id)
			}
			continue
		}
		for id := base; id < end; id++ {
			if bits&(uint64(1)<<(uint32(id-base)&63)) == 0 {
				order = append(order, id)
			}
		}
	}
	t.order = order
}
