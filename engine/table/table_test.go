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
