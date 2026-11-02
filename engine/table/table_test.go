package table

import (
	"errors"
	"testing"
)

func TestInsertColumns(t *testing.T) {
	tbl := fourRows(t)

	if got := tbl.RowCount(); got != 4 {
		t.Fatalf("RowCount() = %d, want 4", got)
	}
	if got := tbl.TotalRows(); got != 4 {
		t.Fatalf("TotalRows() = %d, want 4", got)
	}
	if got := tbl.Revision(); got != 1 {
		t.Fatalf("Revision() = %d, want 1", got)
	}

	v := tbl.View(0, 4)
	if !equalI32(v.RowIDs, []int32{0, 1, 2, 3}) {
		t.Fatalf("RowIDs = %v, want [0 1 2 3]", v.RowIDs)
	}
	if !equalI32(v.Cols[0].I32, []int32{10, 20, 30, 40}) {
		t.Fatalf("col 0 = %v", v.Cols[0].I32)
	}
	if !equalF64(v.Cols[1].F64, []float64{1.5, 2.5, 3.5, 4.5}) {
		t.Fatalf("col 1 = %v", v.Cols[1].F64)
	}
}

func TestInsertColumnsAppendsAndReturnsFirstRowID(t *testing.T) {
	tbl := fourRows(t)

	first, err := tbl.InsertColumns([]ColumnData{
		{I32: []int32{50, 60}},
		{F64: []float64{5.5, 6.5}},
		{Strings: []string{"new", "new"}},
	})
	if err != nil {
		t.Fatalf("InsertColumns: %v", err)
	}

	// Ids carry on from where the first batch stopped: they are positions,
	// not a per-batch counter.
	if first != 4 {
		t.Fatalf("firstRowID = %d, want 4", first)
	}
	if got := tbl.RowCount(); got != 6 {
		t.Fatalf("RowCount() = %d, want 6", got)
	}
	if got := tbl.Revision(); got != 2 {
		t.Fatalf("Revision() = %d, want 2", got)
	}
}

func TestInsertColumnsRejected(t *testing.T) {
	cases := []struct {
		name string
		data []ColumnData
		want error
	}{
		{
			"too few columns",
			[]ColumnData{{I32: []int32{1}}, {F64: []float64{1}}},
			ErrColumnCount,
		},
		{
			"too many columns",
			[]ColumnData{
				{I32: []int32{1}}, {F64: []float64{1}},
				{Strings: []string{"a"}}, {I32: []int32{1}},
			},
			ErrColumnCount,
		},
		{
			"ragged rows",
			[]ColumnData{
				{I32: []int32{1, 2}}, {F64: []float64{1}}, {Strings: []string{"a", "b"}},
			},
			ErrRowCount,
		},
		{
			// A caller filling Strings on an i32 column reads as a column of
			// length zero, which the row-count check catches.
			"wrong field for the column type",
			[]ColumnData{
				{Strings: []string{"a"}}, {F64: []float64{1}}, {Strings: []string{"a"}},
			},
			ErrRowCount,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tbl := fourRows(t)
			before := tbl.Revision()

			if _, err := tbl.InsertColumns(tc.data); !errors.Is(err, tc.want) {
				t.Fatalf("InsertColumns = %v, want %v", err, tc.want)
			}
			if tbl.Revision() != before {
				t.Fatalf("a rejected insert bumped the revision to %d", tbl.Revision())
			}
			if tbl.RowCount() != 4 {
				t.Fatalf("a rejected insert changed RowCount to %d", tbl.RowCount())
			}
		})
	}
}

func TestInsertZeroRowsIsAQuietNoOp(t *testing.T) {
	tbl := fourRows(t)
	before := tbl.Revision()

	// Nothing changed, so subscribers must not be woken: a bump here is a
	// wasted render for every component watching the table.
	first, err := tbl.InsertColumns([]ColumnData{{}, {}, {}})
	if err != nil {
		t.Fatalf("InsertColumns: %v", err)
	}
	if first != 4 {
		t.Fatalf("firstRowID = %d, want 4 (the next id that would be issued)", first)
	}
	if tbl.Revision() != before {
		t.Fatalf("Revision() = %d, want %d", tbl.Revision(), before)
	}
}

func TestInsertIntoEmptyTable(t *testing.T) {
	tbl := newTestTable(t, testSchema())

	if tbl.RowCount() != 0 || tbl.TotalRows() != 0 || tbl.Revision() != 0 {
		t.Fatalf("fresh table: rows=%d total=%d rev=%d", tbl.RowCount(), tbl.TotalRows(), tbl.Revision())
	}

	v := tbl.View(0, 10)
	if len(v.RowIDs) != 0 {
		t.Fatalf("View of an empty table returned %d rows", len(v.RowIDs))
	}
	if len(v.Cols) != 3 {
		t.Fatalf("View of an empty table returned %d columns, want 3", len(v.Cols))
	}
}

func TestSetCell(t *testing.T) {
	tbl := fourRows(t)

	if err := tbl.SetI32(1, 0, 99); err != nil {
		t.Fatalf("SetI32: %v", err)
	}
	if err := tbl.SetF64(1, 1, 9.75); err != nil {
		t.Fatalf("SetF64: %v", err)
	}
	if err := tbl.SetString(1, 2, "cancelled"); err != nil {
		t.Fatalf("SetString: %v", err)
	}

	if got := tbl.Revision(); got != 4 {
		t.Fatalf("Revision() = %d, want 4 (one insert, three edits)", got)
	}

	v := tbl.View(1, 1)
	if v.Cols[0].I32[0] != 99 {
		t.Errorf("i32 cell = %d, want 99", v.Cols[0].I32[0])
	}
	if v.Cols[1].F64[0] != 9.75 {
		t.Errorf("f64 cell = %v, want 9.75", v.Cols[1].F64[0])
	}

	dict, err := tbl.DictSince(2, 0)
	if err != nil {
		t.Fatalf("DictSince: %v", err)
	}
	if got := dict[v.Cols[2].I32[0]]; got != "cancelled" {
		t.Errorf("string cell = %q, want %q", got, "cancelled")
	}
}

func TestSetCellRejected(t *testing.T) {
	cases := []struct {
		name string
		op   func(*Table) error
		want error
	}{
		{"negative row", func(tb *Table) error { return tb.SetI32(-1, 0, 1) }, ErrNoSuchRow},
		{"row past the end", func(tb *Table) error { return tb.SetI32(4, 0, 1) }, ErrNoSuchRow},
		{"negative column", func(tb *Table) error { return tb.SetI32(0, -1, 1) }, ErrNoSuchColumn},
		{"column past the end", func(tb *Table) error { return tb.SetI32(0, 3, 1) }, ErrNoSuchColumn},
		{"i32 write to f64 column", func(tb *Table) error { return tb.SetI32(0, 1, 1) }, ErrWrongType},
		{"f64 write to string column", func(tb *Table) error { return tb.SetF64(0, 2, 1) }, ErrWrongType},
		{"string write to i32 column", func(tb *Table) error { return tb.SetString(0, 0, "x") }, ErrWrongType},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tbl := fourRows(t)
			before := tbl.Revision()

			if err := tc.op(tbl); !errors.Is(err, tc.want) {
				t.Fatalf("op = %v, want %v", err, tc.want)
			}
			if tbl.Revision() != before {
				t.Fatalf("a rejected edit bumped the revision to %d", tbl.Revision())
			}
		})
	}
}

func TestSetCellOnDeletedRow(t *testing.T) {
	tbl := fourRows(t)
	if err := tbl.DeleteRows([]int32{1}); err != nil {
		t.Fatalf("DeleteRows: %v", err)
	}
	before := tbl.Revision()

	ops := map[string]func() error{
		"SetI32":    func() error { return tbl.SetI32(1, 0, 1) },
		"SetF64":    func() error { return tbl.SetF64(1, 1, 1) },
		"SetString": func() error { return tbl.SetString(1, 2, "x") },
	}

	for name, op := range ops {
		t.Run(name, func(t *testing.T) {
			if err := op(); !errors.Is(err, ErrRowDeleted) {
				t.Fatalf("%s on a deleted row = %v, want ErrRowDeleted", name, err)
			}
			if tbl.Revision() != before {
				t.Fatalf("a rejected edit bumped the revision to %d", tbl.Revision())
			}
		})
	}
}

func TestDeleteRows(t *testing.T) {
	tbl := fourRows(t)

	if err := tbl.DeleteRows([]int32{1}); err != nil {
		t.Fatalf("DeleteRows: %v", err)
	}

	if got := tbl.RowCount(); got != 3 {
		t.Fatalf("RowCount() = %d, want 3", got)
	}
	// The tombstone stays: ids are positions, so the row still occupies one.
	if got := tbl.TotalRows(); got != 4 {
		t.Fatalf("TotalRows() = %d, want 4", got)
	}
	if got := tbl.Revision(); got != 2 {
		t.Fatalf("Revision() = %d, want 2", got)
	}

	v := tbl.View(0, 10)
	if !equalI32(v.RowIDs, []int32{0, 2, 3}) {
		t.Fatalf("RowIDs = %v, want [0 2 3]", v.RowIDs)
	}
	if !equalI32(v.Cols[0].I32, []int32{10, 30, 40}) {
		t.Fatalf("col 0 = %v, want [10 30 40]", v.Cols[0].I32)
	}
}

func TestRowIDsSurviveDeletes(t *testing.T) {
	tbl := fourRows(t)

	if err := tbl.DeleteRows([]int32{0, 1}); err != nil {
		t.Fatalf("DeleteRows: %v", err)
	}

	// Row 3 is still row 3 after the rows before it went. If ids shifted,
	// React's keys and every pending edit would point at the wrong row.
	if err := tbl.SetI32(3, 0, 404); err != nil {
		t.Fatalf("SetI32 on a surviving row: %v", err)
	}

	v := tbl.View(0, 10)
	if !equalI32(v.RowIDs, []int32{2, 3}) {
		t.Fatalf("RowIDs = %v, want [2 3]", v.RowIDs)
	}
	if !equalI32(v.Cols[0].I32, []int32{30, 404}) {
		t.Fatalf("col 0 = %v, want [30 404]", v.Cols[0].I32)
	}
}

func TestDeleteRowsRejected(t *testing.T) {
	cases := []struct {
		name string
		ids  []int32
		want error
	}{
		{"negative", []int32{-1}, ErrNoSuchRow},
		{"past the end", []int32{4}, ErrNoSuchRow},
		{"one bad id in a good batch", []int32{0, 99, 2}, ErrNoSuchRow},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tbl := fourRows(t)
			before := tbl.Revision()

			if err := tbl.DeleteRows(tc.ids); !errors.Is(err, tc.want) {
				t.Fatalf("DeleteRows(%v) = %v, want %v", tc.ids, err, tc.want)
			}
			// All or nothing: the good ids in the batch must not have gone
			// through either.
			if tbl.RowCount() != 4 {
				t.Fatalf("RowCount() = %d, want 4: a rejected batch deleted something", tbl.RowCount())
			}
			if tbl.Revision() != before {
				t.Fatalf("a rejected delete bumped the revision to %d", tbl.Revision())
			}
		})
	}
}

func TestDeleteAlreadyDeletedRow(t *testing.T) {
	tbl := fourRows(t)
	if err := tbl.DeleteRows([]int32{1}); err != nil {
		t.Fatalf("DeleteRows: %v", err)
	}
	before := tbl.Revision()

	if err := tbl.DeleteRows([]int32{1}); !errors.Is(err, ErrRowDeleted) {
		t.Fatalf("second delete = %v, want ErrRowDeleted", err)
	}
	if tbl.Revision() != before {
		t.Fatalf("a rejected delete bumped the revision to %d", tbl.Revision())
	}
}

func TestDeleteRepeatedIDInOneBatch(t *testing.T) {
	tbl := fourRows(t)

	// Liveness is judged against the state on entry, so a batch that names
	// the same row twice is harmless rather than an error.
	if err := tbl.DeleteRows([]int32{1, 1}); err != nil {
		t.Fatalf("DeleteRows: %v", err)
	}
	if got := tbl.RowCount(); got != 3 {
		t.Fatalf("RowCount() = %d, want 3", got)
	}
}

func TestDeleteZeroRowsIsAQuietNoOp(t *testing.T) {
	tbl := fourRows(t)
	before := tbl.Revision()

	if err := tbl.DeleteRows(nil); err != nil {
		t.Fatalf("DeleteRows(nil): %v", err)
	}
	if tbl.Revision() != before {
		t.Fatalf("Revision() = %d, want %d", tbl.Revision(), before)
	}
}

func TestDeleteEveryRow(t *testing.T) {
	tbl := fourRows(t)

	if err := tbl.DeleteRows([]int32{0, 1, 2, 3}); err != nil {
		t.Fatalf("DeleteRows: %v", err)
	}
	if got := tbl.RowCount(); got != 0 {
		t.Fatalf("RowCount() = %d, want 0", got)
	}
	if got := len(tbl.View(0, 10).RowIDs); got != 0 {
		t.Fatalf("View returned %d rows from a fully deleted table", got)
	}
	// Ids are still spent, so the next insert carries on past them.
	first, err := tbl.InsertColumns([]ColumnData{
		{I32: []int32{1}}, {F64: []float64{1}}, {Strings: []string{"a"}},
	})
	if err != nil {
		t.Fatalf("InsertColumns: %v", err)
	}
	if first != 4 {
		t.Fatalf("firstRowID after deleting everything = %d, want 4", first)
	}
}

func TestIsDeleted(t *testing.T) {
	tbl := fourRows(t)
	if err := tbl.DeleteRows([]int32{2}); err != nil {
		t.Fatalf("DeleteRows: %v", err)
	}

	cases := []struct {
		rowID int32
		want  bool
		err   error
	}{
		{0, false, nil},
		{2, true, nil},
		{-1, false, ErrNoSuchRow},
		{4, false, ErrNoSuchRow},
	}

	for _, tc := range cases {
		got, err := tbl.IsDeleted(tc.rowID)
		if !errors.Is(err, tc.err) {
			t.Errorf("IsDeleted(%d) error = %v, want %v", tc.rowID, err, tc.err)
			continue
		}
		if got != tc.want {
			t.Errorf("IsDeleted(%d) = %v, want %v", tc.rowID, got, tc.want)
		}
	}
}

// Deletes land on either side of a 64-row word boundary, which is where the
// bitset's whole-word fast path in rebuildOrder either works or quietly
// drops rows.
func TestDeletesAcrossWordBoundaries(t *testing.T) {
	const n = 200
	ids := make([]int32, n)
	prices := make([]float64, n)
	statuses := make([]string, n)
	for i := range ids {
		ids[i] = int32(i)
		prices[i] = float64(i)
		statuses[i] = "s"
	}
	tbl := seeded(t, ids, prices, statuses)

	// 63 and 64 straddle the first boundary; 127/128 the second; 199 is the
	// last row of a partly filled final word.
	deleted := []int32{0, 63, 64, 127, 128, 199}
	if err := tbl.DeleteRows(deleted); err != nil {
		t.Fatalf("DeleteRows: %v", err)
	}

	if got := tbl.RowCount(); got != n-int32(len(deleted)) {
		t.Fatalf("RowCount() = %d, want %d", got, n-int32(len(deleted)))
	}

	gone := map[int32]bool{}
	for _, id := range deleted {
		gone[id] = true
	}
	v := tbl.View(0, n)
	if int32(len(v.RowIDs)) != tbl.RowCount() {
		t.Fatalf("View returned %d rows, RowCount() says %d", len(v.RowIDs), tbl.RowCount())
	}
	prev := int32(-1)
	for _, id := range v.RowIDs {
		if gone[id] {
			t.Fatalf("deleted row %d came back in the view", id)
		}
		if id <= prev {
			t.Fatalf("order is not ascending: %d after %d", id, prev)
		}
		prev = id
	}
}

func TestRevisionOnlyMovesOnSuccess(t *testing.T) {
	tbl := newTestTable(t, testSchema())

	steps := []struct {
		name    string
		op      func() error
		wantRev uint32
	}{
		{"fresh table", func() error { return nil }, 0},
		{"insert", func() error {
			_, err := tbl.InsertColumns([]ColumnData{
				{I32: []int32{1, 2}}, {F64: []float64{1, 2}}, {Strings: []string{"a", "b"}},
			})
			return err
		}, 1},
		{"edit", func() error { return tbl.SetI32(0, 0, 7) }, 2},
		{"rejected edit", func() error { return nil }, 2},
		{"delete", func() error { return tbl.DeleteRows([]int32{1}) }, 3},
		{"rejected delete", func() error { return nil }, 3},
	}

	for _, s := range steps {
		t.Run(s.name, func(t *testing.T) {
			if err := s.op(); err != nil {
				t.Fatalf("op: %v", err)
			}
			switch s.name {
			case "rejected edit":
				_ = tbl.SetI32(99, 0, 1)
			case "rejected delete":
				_ = tbl.DeleteRows([]int32{99})
			}
			if got := tbl.Revision(); got != s.wantRev {
				t.Fatalf("Revision() = %d, want %d", got, s.wantRev)
			}
		})
	}
}

/* ------------------------------------------------------------------ */
/* Revision wrapping                                                   */
/* ------------------------------------------------------------------ */

func TestNextRevisionStaysInsideThirtyOneBits(t *testing.T) {
	cases := []struct {
		name string
		from uint32
		want uint32
	}{
		{"from zero", 0, 1},
		{"ordinary", 41, 42},
		{"one below the top", revisionMask - 1, revisionMask},
		// The value crosses to JS as an int32, where a negative number is a
		// status code. Wrapping here is what keeps it from ever looking
		// like one.
		{"at the top, wraps to zero", revisionMask, 0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := nextRevision(tc.from); got != tc.want {
				t.Fatalf("nextRevision(%d) = %d, want %d", tc.from, got, tc.want)
			}
		})
	}
}

func TestRevisionIsNeverNegativeAsInt32(t *testing.T) {
	r := uint32(0)
	// Walk the wrap point rather than two billion mutations.
	for _, start := range []uint32{0, revisionMask - 3, revisionMask} {
		r = start
		for i := 0; i < 8; i++ {
			r = nextRevision(r)
			if int32(r) < 0 {
				t.Fatalf("revision %d reads as %d, which collides with a status code", r, int32(r))
			}
			if r > revisionMask {
				t.Fatalf("revision %d is outside 31 bits", r)
			}
		}
	}
}

func TestRevisionWrapsAroundInPractice(t *testing.T) {
	tbl := fourRows(t)
	// Park the counter one short of the wrap, then mutate across it.
	tbl.revision = revisionMask
	if err := tbl.SetI32(0, 0, 1); err != nil {
		t.Fatalf("SetI32: %v", err)
	}
	if got := tbl.Revision(); got != 0 {
		t.Fatalf("Revision() = %d, want 0 after wrapping", got)
	}
	if err := tbl.SetI32(0, 0, 2); err != nil {
		t.Fatalf("SetI32: %v", err)
	}
	if got := tbl.Revision(); got != 1 {
		t.Fatalf("Revision() = %d, want 1", got)
	}
}

/* ------------------------------------------------------------------ */
/* Order rebuilds                                                      */
/* ------------------------------------------------------------------ */

func TestSetCellSkipsTheOrderRebuild(t *testing.T) {
	tbl := fourRows(t)

	// Scribble on the order. With no sort or filter spec the order depends
	// only on which rows are live, so a cell edit must leave it alone and
	// the scribble has to survive. At 200k rows that rebuild was the entire
	// cost of a SetCell.
	scribble := func() { tbl.order[0] = 99 }
	scribbled := func() bool { return tbl.order[0] == 99 }

	edits := map[string]func() error{
		"SetI32":    func() error { return tbl.SetI32(1, 0, 7) },
		"SetF64":    func() error { return tbl.SetF64(1, 1, 7) },
		"SetString": func() error { return tbl.SetString(1, 2, "x") },
		"SetStringBytes": func() error {
			return tbl.SetStringBytes(1, 2, []byte("y"))
		},
	}

	for name, edit := range edits {
		t.Run(name, func(t *testing.T) {
			scribble()
			before := tbl.Revision()
			if err := edit(); err != nil {
				t.Fatalf("%s: %v", name, err)
			}
			if !scribbled() {
				t.Fatalf("%s rebuilt the order", name)
			}
			// The revision still moves: the cell did change.
			if tbl.Revision() == before {
				t.Fatalf("%s did not bump the revision", name)
			}
		})
	}
}

func TestInsertAndDeleteStillRebuildTheOrder(t *testing.T) {
	t.Run("delete", func(t *testing.T) {
		tbl := fourRows(t)
		tbl.order[0] = 99
		if err := tbl.DeleteRows([]int32{2}); err != nil {
			t.Fatalf("DeleteRows: %v", err)
		}
		if !equalI32(tbl.order, []int32{0, 1, 3}) {
			t.Fatalf("order = %v, want [0 1 3]: a delete must rebuild", tbl.order)
		}
	})

	t.Run("insert", func(t *testing.T) {
		tbl := fourRows(t)
		tbl.order[0] = 99
		if _, err := tbl.InsertColumns([]ColumnData{
			{I32: []int32{50}}, {F64: []float64{5.5}}, {Strings: []string{"new"}},
		}); err != nil {
			t.Fatalf("InsertColumns: %v", err)
		}
		if !equalI32(tbl.order, []int32{0, 1, 2, 3, 4}) {
			t.Fatalf("order = %v, want [0 1 2 3 4]: an insert must rebuild", tbl.order)
		}
	})

	t.Run("a rejected mutation changes nothing", func(t *testing.T) {
		tbl := fourRows(t)
		tbl.order[0] = 99
		if err := tbl.SetI32(999, 0, 1); err == nil {
			t.Fatal("expected an error")
		}
		if tbl.order[0] != 99 {
			t.Fatal("a rejected edit rebuilt the order")
		}
	})
}

/* ------------------------------------------------------------------ */
/* Allocation                                                          */
/* ------------------------------------------------------------------ */

func TestRepeatedWorkAllocatesNothing(t *testing.T) {
	tbl := seeded(t,
		[]int32{1, 2, 3, 4},
		[]float64{1, 2, 3, 4},
		[]string{"new", "shipped", "new", "held"},
	)
	existing := []byte("shipped")

	// The steady state: cells set to values the column already holds, over
	// and over. Nothing here is new data, so nothing may reach the heap.
	allocs := testing.AllocsPerRun(200, func() {
		_ = tbl.SetI32(0, 0, 7)
		_ = tbl.SetF64(0, 1, 7)
		_ = tbl.SetStringBytes(0, 2, existing)
	})
	if allocs != 0 {
		t.Fatalf("allocated %v times per run, want 0", allocs)
	}
}

func TestInsertGrowsEachColumnOnce(t *testing.T) {
	tbl := newTestTable(t, testSchema())

	const n = 1000
	ids := make([]int32, n)
	prices := make([]float64, n)
	statuses := make([]string, n)
	for i := range ids {
		ids[i] = int32(i)
		prices[i] = float64(i)
		statuses[i] = "s"
	}

	if _, err := tbl.InsertColumns([]ColumnData{
		{I32: ids}, {F64: prices}, {Strings: statuses},
	}); err != nil {
		t.Fatalf("InsertColumns: %v", err)
	}

	// Sized to the rows held, with nothing spare: append's geometric growth
	// would leave up to twice this behind for the collector.
	if got := cap(tbl.cols[0].i32); got != n {
		t.Errorf("i32 column capacity = %d, want exactly %d", got, n)
	}
	if got := cap(tbl.cols[1].f64); got != n {
		t.Errorf("f64 column capacity = %d, want exactly %d", got, n)
	}
	if got := cap(tbl.cols[2].i32); got != n {
		t.Errorf("string column capacity = %d, want exactly %d", got, n)
	}
}
