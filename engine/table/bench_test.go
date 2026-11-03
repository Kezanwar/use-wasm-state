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

// The two ways to read a viewport, measured against each other. View is the
// comfortable API and allocates a fresh slice per column per call;
// ViewInto + Gather reuse the caller's scratch and allocate nothing. The ABI
// uses the second one because it runs on every scroll frame.
func BenchmarkViewAllocating(b *testing.B) {
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

func BenchmarkViewIntoReusingScratch(b *testing.B) {
	tbl := benchTable(b)
	ids := make([]int32, 50)
	i32 := make([]int32, 50)
	f64 := make([]float64, 50)

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		n := tbl.ViewInto(0, 50, ids)
		if n != 50 {
			b.Fatalf("ViewInto returned %d rows", n)
		}
		if err := tbl.GatherI32(0, ids, i32); err != nil {
			b.Fatal(err)
		}
		if err := tbl.GatherF64(1, ids, f64); err != nil {
			b.Fatal(err)
		}
		if err := tbl.GatherI32(2, ids, i32); err != nil {
			b.Fatal(err)
		}
	}
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

// benchQueryTable is the dataset the query benchmarks run on: the same
// shape as the demo's orders, at the same scale.
func benchQueryTable(b *testing.B) *Table {
	b.Helper()
	tbl := newTestTable(b, testSchema())

	labels := []string{"new", "paid", "picked", "shipped", "held", "cancelled"}
	ids := make([]int32, benchRows)
	prices := make([]float64, benchRows)
	statuses := make([]string, benchRows)
	for i := 0; i < benchRows; i++ {
		// Deliberately not in order: a sort on an already-sorted column
		// flatters any implementation.
		ids[i] = int32((i * 7919) % benchRows)
		prices[i] = float64((i*31)%100_000) / 100
		statuses[i] = labels[(i*13)%len(labels)]
	}
	if _, err := tbl.InsertColumns([]ColumnData{
		{I32: ids}, {F64: prices}, {Strings: statuses},
	}); err != nil {
		b.Fatalf("InsertColumns: %v", err)
	}
	return tbl
}

// runQuery measures applying a query from scratch each time, which is what
// a header click or a keystroke in a search box costs.
func runQuery(b *testing.B, mode sortMode, q Query) {
	tbl := benchQueryTable(b)
	tbl.sortMode = mode
	if err := tbl.SetQuery(q); err != nil {
		b.Fatalf("SetQuery: %v", err)
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tbl.rebuildOrder()
	}
}

func BenchmarkSortF64Radix(b *testing.B) {
	runQuery(b, sortRadix, Query{Sort: []SortKey{{Col: 1}}})
}
func BenchmarkSortF64Compare(b *testing.B) {
	runQuery(b, sortCompare, Query{Sort: []SortKey{{Col: 1}}})
}

func BenchmarkSortI32Radix(b *testing.B) {
	runQuery(b, sortRadix, Query{Sort: []SortKey{{Col: 0}}})
}
func BenchmarkSortI32Compare(b *testing.B) {
	runQuery(b, sortCompare, Query{Sort: []SortKey{{Col: 0}}})
}

func BenchmarkSortStringRadix(b *testing.B) {
	runQuery(b, sortRadix, Query{Sort: []SortKey{{Col: 2}}})
}
func BenchmarkSortStringCompare(b *testing.B) {
	runQuery(b, sortCompare, Query{Sort: []SortKey{{Col: 2}}})
}

func BenchmarkSortMultiRadix(b *testing.B) {
	runQuery(b, sortRadix, Query{Sort: []SortKey{{Col: 2}, {Col: 1, Desc: true}}})
}
func BenchmarkSortMultiCompare(b *testing.B) {
	runQuery(b, sortCompare, Query{Sort: []SortKey{{Col: 2}, {Col: 1, Desc: true}}})
}

func BenchmarkFilterNumeric(b *testing.B) {
	runQuery(b, sortRadix, Query{Filters: []Filter{{Col: 1, Op: OpGt, Number: 500}}})
}

func BenchmarkFilterBetween(b *testing.B) {
	runQuery(b, sortRadix, Query{
		Filters: []Filter{{Col: 1, Op: OpBetween, Number: 200, Upper: 800}},
	})
}

func BenchmarkFilterStringEq(b *testing.B) {
	runQuery(b, sortRadix, Query{Filters: []Filter{{Col: 2, Op: OpEq, Text: "shipped"}}})
}

func BenchmarkFilterStringIn(b *testing.B) {
	runQuery(b, sortRadix, Query{
		Filters: []Filter{{Col: 2, Op: OpIn, List: []string{"shipped", "paid"}}},
	})
}

func BenchmarkFilterStringContains(b *testing.B) {
	runQuery(b, sortRadix, Query{Filters: []Filter{{Col: 2, Op: OpContains, Text: "ip"}}})
}

func BenchmarkSearch(b *testing.B) {
	runQuery(b, sortRadix, Query{Search: "ip"})
}

// BenchmarkQueryPipeline is all three at once, which is what the demo's
// toolbar produces.
func BenchmarkQueryPipeline(b *testing.B) {
	runQuery(b, sortRadix, Query{
		Filters: []Filter{{Col: 1, Op: OpGt, Number: 100}},
		Search:  "e",
		Sort:    []SortKey{{Col: 1, Desc: true}},
	})
}

// BenchmarkSetCellUnderSort is a keystroke in a cell the sort reads, so
// every edit re-orders the whole table.
func BenchmarkSetCellUnderSort(b *testing.B) {
	tbl := benchQueryTable(b)
	if err := tbl.SetQuery(Query{Sort: []SortKey{{Col: 1}}}); err != nil {
		b.Fatalf("SetQuery: %v", err)
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := tbl.SetF64(int32(i%benchRows), 1, float64(i%1000)); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkSetCellOffSort is the same edit on a column the query ignores,
// which skips the rebuild entirely.
func BenchmarkSetCellOffSort(b *testing.B) {
	tbl := benchQueryTable(b)
	if err := tbl.SetQuery(Query{Sort: []SortKey{{Col: 1}}}); err != nil {
		b.Fatalf("SetQuery: %v", err)
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := tbl.SetI32(int32(i%benchRows), 0, int32(i)); err != nil {
			b.Fatal(err)
		}
	}
}
