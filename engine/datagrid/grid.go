package datagrid

import "math"

// column is one column's storage. Which slice is live follows typ; the other
// is nil. A string column keeps its dictionary ids in i32, because that is
// exactly what View hands back and what crosses to JS.
type column struct {
	typ  ColumnType
	i32  []int32   // I32 values, or String dictionary ids
	f64  []float64 // F64 values
	dict dictionary

	// The sort ranks, rebuilt only when the dictionary has grown past the
	// stamp. The lowercase mirror lives on the dictionary itself, because
	// it is appended with each entry rather than derived later.
	rank      []int32 // dictionary id -> position in value order
	rankOrder []int32 // scratch for building rank
	rankFor   int32   // dictionary length rank was built for
}

// Grid is a columnar store with stable row ids.
//
// Not safe for concurrent use. One grid belongs to one engine instance,
// which belongs to one thread: the main thread or one worker.
type Grid struct {
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

	// slots is what Reserve last returned, kept so an append does not
	// allocate the slice that describes it, and reserved is how many rows
	// it made room for: the only count Commit accepts.
	slots    []ColumnData
	reserved int32

	// parsed is the query as a struct, for reading and applying; query is
	// the same thing flattened to bytes, for telling one query from
	// another in a single comparison. See SetQuery.
	parsed       Query
	query        []byte
	queryScratch []byte

	// Which dictionary entries each string filter and the search accept.
	// Indexed by filter position and by column respectively.
	filterMatch []matchSet
	searchMatch []matchSet

	// Scratch for the sort, sized to the row count and reused.
	sortKeys        []uint64
	sortKeysScratch []uint64
	orderScratch    []int32
	sortMode        sortMode

	revision uint32
}

// revisionMask keeps the revision inside 31 bits.
//
// It crosses to JS as an int32, where every export that can fail returns a
// small negative status. A counter allowed to reach the top bit would come
// back negative and be read as one of those. Wrapping a bit early costs
// nothing: the value only has to differ from the one before it.
const revisionMask uint32 = 0x7fffffff

func nextRevision(r uint32) uint32 { return (r + 1) & revisionMask }

// ColumnData carries one column's worth of rows: new rows for InsertColumns,
// text for Commit, or the reserved space Reserve hands back.
// Exactly one field is set, matching that column's type. Strings are
// interned on the way in; the caller never sees an id.
//
// A string column takes either Strings or the packed pair, not both.
type ColumnData struct {
	I32     []int32
	F64     []float64
	Strings []string

	// Blob and Offsets are the packed form of Strings: one UTF-8 run plus
	// rowCount+1 byte offsets into it, so row i is
	// Blob[Offsets[i]:Offsets[i+1]].
	//
	// This is the form rows arrive in from JS, and the form that keeps the
	// engine quiet: interning straight from the bytes allocates only for a
	// value the column has never held, where building a Go string per row
	// would allocate 200k times to keep six of them.
	Blob    []byte
	Offsets []int32
}

// packed reports whether a string column was given in the packed form.
// Offsets always has one more entry than there are rows, so a non-nil
// Offsets is unambiguous even for an insert of no rows.
func (d *ColumnData) packed() bool { return d.Offsets != nil }

func newGrid(s Schema) *Grid {
	t := &Grid{schema: s.clone()}
	// Seeded with the empty query's own bytes rather than left nil, so
	// setting an empty query on a fresh grid compares equal and does not
	// bump the revision for a change nobody made.
	t.query = appendQuery(nil, &t.parsed)
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
func (t *Grid) Revision() uint32 { return t.revision }

// RowCount is the number of live rows, which is the length of the current
// order. Tombstoned rows are not counted.
func (t *Grid) RowCount() int32 { return int32(len(t.order)) }

// TotalRows counts every row ever appended, tombstones included. It is the
// exclusive upper bound on a valid row id, not something to render.
func (t *Grid) TotalRows() int32 { return t.rows }

// Schema returns the grid's columns in order. Treat it as read-only: it
// backs the grid's own storage layout.
func (t *Grid) Schema() Schema { return t.schema }

// IsDeleted reports whether a valid row id has been tombstoned.
func (t *Grid) IsDeleted(rowID int32) (bool, error) {
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
func (t *Grid) liveRow(rowID int32) error {
	if rowID < 0 || rowID >= t.rows {
		return ErrNoSuchRow
	}
	if t.deleted.get(rowID) {
		return ErrRowDeleted
	}
	return nil
}

func (t *Grid) columnOf(col int32, want ColumnType) (*column, error) {
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
// It is Reserve and Commit with a copy in between, for callers that already
// hold the rows in Go. The ABI does the same thing without the copy: JS
// writes each column straight into the space Reserve hands back.
//
// Appending zero rows succeeds and does not bump the revision: there is
// nothing for a subscriber to re-render.
func (t *Grid) InsertColumns(data []ColumnData) (firstRowID int32, err error) {
	if len(data) != len(t.cols) {
		return 0, ErrColumnCount
	}
	n := columnLen(&data[0], t.cols[0].typ)
	for i := range t.cols {
		if columnLen(&data[i], t.cols[i].typ) != n {
			return 0, ErrRowCount
		}
	}

	slots, err := t.Reserve(n)
	if err != nil {
		return 0, err
	}
	for i := range t.cols {
		switch t.cols[i].typ {
		case I32:
			copy(slots[i].I32, data[i].I32)
		case F64:
			copy(slots[i].F64, data[i].F64)
		}
	}
	return t.Commit(n, data)
}

// Reserve makes room for n more rows without adding them, and returns one
// slice per column, each n long, over the storage those rows will occupy:
// F64 for an f64 column, I32 for the rest, a string column's being its
// dictionary ids.
//
// This is how a load avoids holding the dataset twice. The caller writes
// every column into its final place, then calls Commit. Until then the grid
// is unchanged, so a caller that reserves and gives up leaves only spare
// capacity behind. The slices are valid until the next Reserve.
//
// Capacity doubles when it runs out, so appends are amortised: after a 200k
// load, adding a row copies one row, not 200k. A first load sizes exactly,
// so it leaves no slack behind.
func (t *Grid) Reserve(n int32) ([]ColumnData, error) {
	if n < 0 || n > math.MaxInt32-t.rows {
		return nil, ErrRowCount
	}
	total := t.rows + n
	if len(t.slots) != len(t.cols) {
		t.slots = make([]ColumnData, len(t.cols))
	}
	for i := range t.cols {
		c := &t.cols[i]
		if c.typ == F64 {
			c.f64 = reserve(c.f64, total)
			t.slots[i] = ColumnData{F64: c.f64[t.rows:total]}
		} else {
			c.i32 = reserve(c.i32, total)
			t.slots[i] = ColumnData{I32: c.i32[t.rows:total]}
		}
	}
	t.reserved = n
	return t.slots, nil
}

// Commit adds the n rows written into the slices Reserve returned, and
// returns the id of the first. n must be what Reserve was given.
//
// Numeric values are already in place; their entries in text are ignored.
// A string column's entry carries its rows as text, Strings or packed, and
// they are interned into the reserved ids here. Everything is checked
// before anything changes, so a rejected commit leaves the grid as it was.
func (t *Grid) Commit(n int32, text []ColumnData) (firstRowID int32, err error) {
	if len(text) != len(t.cols) {
		return 0, ErrColumnCount
	}
	if n < 0 || n > math.MaxInt32-t.rows {
		return 0, ErrRowCount
	}
	// Anything but what was reserved would commit rows nobody wrote.
	if n != t.reserved {
		return 0, ErrRowCount
	}
	total := t.rows + n
	for i := range t.cols {
		c := &t.cols[i]
		if c.typ != String {
			continue
		}
		if columnLen(&text[i], String) != n {
			return 0, ErrRowCount
		}
		if text[i].packed() {
			if err := checkOffsets(&text[i]); err != nil {
				return 0, err
			}
		}
	}
	t.reserved = 0
	if n == 0 {
		return t.rows, nil
	}

	first := t.rows
	for i := range t.cols {
		c := &t.cols[i]
		if c.typ == F64 {
			c.f64 = c.f64[:total]
			continue
		}
		c.i32 = c.i32[:total]
		if c.typ != String {
			continue
		}
		// Interning is the expensive part of a large insert: one hash and
		// one comparison per cell. It buys a column that is four bytes a
		// row however long the strings are, and a dictionary JS fetches
		// once instead of a string per cell per frame.
		c.dict.sizeHint(n)
		ids := c.i32[first:]
		if text[i].packed() {
			blob, offs := text[i].Blob, text[i].Offsets
			for j := int32(0); j < n; j++ {
				ids[j] = c.dict.internBytes(blob[offs[j]:offs[j+1]])
			}
		} else {
			for j, v := range text[i].Strings {
				ids[j] = c.dict.intern(v)
			}
		}
	}

	t.rows = total
	t.deleted.grow(t.rows)
	t.revision = nextRevision(t.revision)
	if !t.parsed.empty() {
		t.rebuildOrder()
		return first, nil
	}
	// With no query the order is every live row by id, and new rows are
	// live and come last: append them rather than rebuild 200k rows to add
	// one.
	t.order = reserve(t.order, int32(len(t.order))+n)
	for id := first; id < total; id++ {
		t.order = append(t.order, id)
	}
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
		if d.packed() {
			return int32(len(d.Offsets)) - 1
		}
		return int32(len(d.Strings))
	}
	return 0
}

// checkOffsets validates a packed string column before anything is written.
// Offsets must run forwards and stay inside the blob; otherwise the insert
// would read whatever happens to follow it in memory.
func checkOffsets(d *ColumnData) error {
	offs := d.Offsets
	prev := int32(0)
	if len(offs) > 0 {
		prev = offs[0]
	}
	if prev < 0 || int(prev) > len(d.Blob) {
		return ErrRowCount
	}
	for i := 1; i < len(offs); i++ {
		if offs[i] < prev || int(offs[i]) > len(d.Blob) {
			return ErrRowCount
		}
		prev = offs[i]
	}
	return nil
}

// reserve returns s with capacity for at least n elements, keeping its
// length. Growth doubles, or goes straight to n when that is further, so a
// single large load allocates exactly once and a run of small appends is
// amortised.
func reserve[T int32 | float64](s []T, n int32) []T {
	if int32(cap(s)) >= n {
		return s
	}
	size := 2 * cap(s)
	if size < int(n) {
		size = int(n)
	}
	out := make([]T, len(s), size)
	copy(out, s)
	return out
}

// SetI32 writes one cell of an i32 column.
func (t *Grid) SetI32(rowID, col int32, v int32) error {
	if err := t.liveRow(rowID); err != nil {
		return err
	}
	c, err := t.columnOf(col, I32)
	if err != nil {
		return err
	}
	c.i32[rowID] = v
	t.bumpValues(col)
	return nil
}

// SetF64 writes one cell of an f64 column.
func (t *Grid) SetF64(rowID, col int32, v float64) error {
	if err := t.liveRow(rowID); err != nil {
		return err
	}
	c, err := t.columnOf(col, F64)
	if err != nil {
		return err
	}
	c.f64[rowID] = v
	t.bumpValues(col)
	return nil
}

// SetString writes one cell of a string column, interning the value.
//
// A value the column has not held before appends to its dictionary, so JS
// has to pick up the new entry (DictSince) before it can render the cell.
func (t *Grid) SetString(rowID, col int32, v string) error {
	if err := t.liveRow(rowID); err != nil {
		return err
	}
	c, err := t.columnOf(col, String)
	if err != nil {
		return err
	}
	c.i32[rowID] = c.dict.intern(v)
	t.bumpValues(col)
	return nil
}

// SetStringBytes is SetString for a value that is still UTF-8 bytes.
//
// What the ABI calls: the value is sitting in the input buffer, and turning
// it into a Go string first would allocate on every keystroke even when the
// column already holds that exact value. Only a value the column has never
// seen reaches the heap.
func (t *Grid) SetStringBytes(rowID, col int32, v []byte) error {
	if err := t.liveRow(rowID); err != nil {
		return err
	}
	c, err := t.columnOf(col, String)
	if err != nil {
		return err
	}
	c.i32[rowID] = c.dict.internBytes(v)
	t.bumpValues(col)
	return nil
}

// DeleteRows tombstones rows. Column data is left where it is, so every
// surviving row keeps its id.
//
// All or nothing: if any id is unknown or already deleted the grid is
// untouched and the revision does not move. Repeating an id inside one batch
// is harmless, since liveness is judged against the state on entry.
//
// Deleting zero rows succeeds and does not bump the revision.
func (t *Grid) DeleteRows(rowIDs []int32) error {
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
	t.bumpLiveness()
	return nil
}

/* ------------------------------------------------------------------ */
/* Order                                                               */
/* ------------------------------------------------------------------ */

// bumpValues ends a mutation that changed cell values but not which rows
// are live.
//

// An edit to a column the query never looks at cannot move anything, so
// the rebuild is skipped. At 200k rows that is the difference between an
// edit costing nothing and costing a millisecond.
func (t *Grid) bumpValues(col int32) {
	t.revision = nextRevision(t.revision)
	if t.affectsOrder(col) {
		t.rebuildOrder()
	}
}

// bumpLiveness ends a mutation that changed which rows exist. The order is
// derived from liveness, so it always has to be rebuilt.
func (t *Grid) bumpLiveness() {
	t.revision = nextRevision(t.revision)
	t.rebuildOrder()
}

// rebuildOrder recomputes the live row ids in display order.
//
// v1 is every live row in id order. The order is rebuilt rather than patched
// because step 7 makes it the output of the sort/filter/search spec, where an
// edit to one cell can move a row anywhere. That costs O(rows) per mutation,
// including a single SetCell; at 200k rows it is well inside a frame, and the
// alternative is a patch path that step 7 would have to throw away.
func (t *Grid) rebuildOrder() {
	t.ensureFilterMatches()
	t.ensureSearchMatches()

	filtered := len(t.parsed.Filters) > 0
	searching := t.parsed.Search != ""

	// Sized for every row up front, so a rebuild never grows the order by
	// appending and leaves no trail of outgrown copies for the collector.
	t.order = reserve(t.order, t.rows)
	order := t.order[:0]
	for w := 0; w < len(t.deleted); w++ {
		base := int32(w) << 6
		end := base + 64
		if end > t.rows {
			end = t.rows
		}
		bits := t.deleted[w]
		if bits == 0 && !filtered && !searching {
			// No tombstones in these 64 rows and nothing to test, which is
			// the common case and worth skipping the per-row work for.
			for id := base; id < end; id++ {
				order = append(order, id)
			}
			continue
		}
		for id := base; id < end; id++ {
			if bits&(uint64(1)<<(uint32(id-base)&63)) != 0 {
				continue
			}
			if filtered && !t.passesFilters(id) {
				continue
			}
			if searching && !t.matchesSearch(id) {
				continue
			}
			order = append(order, id)
		}
	}
	t.order = order

	t.applySort(t.order)
}
