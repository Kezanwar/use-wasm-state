package table

import "testing"

// The schema most tests use: one of every column type, so a single insert
// exercises the i32, f64 and dictionary paths together.
func testSchema() Schema {
	return Schema{
		{Name: "id", Type: I32},
		{Name: "price", Type: F64},
		{Name: "status", Type: String},
	}
}

func newTestTable(t testing.TB, s Schema) *Table {
	t.Helper()
	e := NewEngine()
	id, err := e.CreateTable(s)
	if err != nil {
		t.Fatalf("CreateTable: %v", err)
	}
	tbl, err := e.Table(id)
	if err != nil {
		t.Fatalf("Table: %v", err)
	}
	return tbl
}

// seeded returns a table holding the given rows, already inserted.
func seeded(t testing.TB, ids []int32, prices []float64, statuses []string) *Table {
	t.Helper()
	tbl := newTestTable(t, testSchema())
	if _, err := tbl.InsertColumns([]ColumnData{
		{I32: ids},
		{F64: prices},
		{Strings: statuses},
	}); err != nil {
		t.Fatalf("InsertColumns: %v", err)
	}
	return tbl
}

func fourRows(t testing.TB) *Table {
	t.Helper()
	return seeded(t,
		[]int32{10, 20, 30, 40},
		[]float64{1.5, 2.5, 3.5, 4.5},
		[]string{"new", "shipped", "new", "held"},
	)
}

func equalI32(a, b []int32) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func equalF64(a, b []float64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
