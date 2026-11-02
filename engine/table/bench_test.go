package table

import "testing"

// The flagship demo's size. Everything here is measured at this scale
// because the design only has to justify itself at this scale: 200 rows
// would be faster in plain JS.
const benchRows = 200_000

// benchData builds one batch of benchRows rows.
//
// The string column draws from a small set of labels, which is what a status
// or category column really looks like and what dictionary encoding is for.
// A column of 200k distinct strings would be a different benchmark.
func benchData() []ColumnData {
	labels := []string{"new", "paid", "picked", "shipped", "held", "cancelled"}

	ids := make([]int32, benchRows)
	prices := make([]float64, benchRows)
	statuses := make([]string, benchRows)
	for i := 0; i < benchRows; i++ {
		ids[i] = int32(i)
		prices[i] = float64(i) * 1.5
		statuses[i] = labels[i%len(labels)]
	}

	return []ColumnData{{I32: ids}, {F64: prices}, {Strings: statuses}}
}

func benchTable(b *testing.B) *Table {
	b.Helper()
	tbl := newTestTable(b, testSchema())
	if _, err := tbl.InsertColumns(benchData()); err != nil {
		b.Fatalf("InsertColumns: %v", err)
	}
	return tbl
}

// BenchmarkInsertColumns is the load-once path: the one call that carries a
// whole dataset across the wasm boundary.
func BenchmarkInsertColumns(b *testing.B) {
	data := benchData()
	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		b.StopTimer()
		tbl := newTestTable(b, testSchema())
		b.StartTimer()

		if _, err := tbl.InsertColumns(data); err != nil {
			b.Fatalf("InsertColumns: %v", err)
		}
	}
}

// BenchmarkView is the per-frame path: one viewport out of 200k rows. This
// is the number the whole design rests on.
func BenchmarkView(b *testing.B) {
	tbl := benchTable(b)
	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		v := tbl.View(0, 50)
		if len(v.RowIDs) != 50 {
			b.Fatalf("View returned %d rows", len(v.RowIDs))
		}
	}
}

// BenchmarkViewDeep reads from the middle of the table, where the row ids in
// the window are far from the start of each column slice.
func BenchmarkViewDeep(b *testing.B) {
	tbl := benchTable(b)
	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		v := tbl.View(benchRows/2, 50)
		if len(v.RowIDs) != 50 {
			b.Fatalf("View returned %d rows", len(v.RowIDs))
		}
	}
}

// BenchmarkSetCell is one edit, and so one keystroke in a grid.
//
// It is dominated by the rebuildOrder that ends every mutation, which is
// O(rows) whatever the mutation touched. See rebuildOrder on why v1 pays
// that rather than keeping a patch path step 7 would discard.
func BenchmarkSetCell(b *testing.B) {
	tbl := benchTable(b)
	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		if err := tbl.SetF64(int32(i%benchRows), 1, float64(i)); err != nil {
			b.Fatalf("SetF64: %v", err)
		}
	}
}

// BenchmarkSetCellString additionally interns, which for a value already in
// the dictionary is one map lookup.
func BenchmarkSetCellString(b *testing.B) {
	tbl := benchTable(b)
	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		if err := tbl.SetString(int32(i%benchRows), 2, "shipped"); err != nil {
			b.Fatalf("SetString: %v", err)
		}
	}
}

// BenchmarkDeleteRows deletes 1k rows out of 200k in one call.
func BenchmarkDeleteRows(b *testing.B) {
	tbl := benchTable(b)

	ids := make([]int32, 1000)
	for i := range ids {
		ids[i] = int32(i * 37 % benchRows)
	}

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		b.StopTimer()
		// Untombstone everything so the next iteration deletes the same
		// rows again. Reaching into the table is fine here: this is the
		// same package, and rebuilding a fresh 200k table per iteration
		// would cost more setup than the thing being measured.
		for w := range tbl.deleted {
			tbl.deleted[w] = 0
		}
		tbl.rebuildOrder()
		b.StartTimer()

		if err := tbl.DeleteRows(ids); err != nil {
			b.Fatalf("DeleteRows: %v", err)
		}
	}
}

// BenchmarkRebuildOrder isolates the cost every mutation pays, so the
// SetCell and DeleteRows numbers above can be read against it.
func BenchmarkRebuildOrder(b *testing.B) {
	tbl := benchTable(b)
	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		tbl.rebuildOrder()
	}
}
