package datagrid

import (
	"errors"
	"testing"
)

// A grid with enough variety to sort and filter meaningfully.
//
//	id   price  status
//	 0    30.0  "paid"
//	 1    10.0  "new"
//	 2    20.0  "paid"
//	 3    10.0  "Shipped"
//	 4    40.0  "new"
func queryGrid(t testing.TB) *Grid {
	t.Helper()
	return seeded(t,
		[]int32{100, 200, 300, 400, 500},
		[]float64{30, 10, 20, 10, 40},
		[]string{"paid", "new", "paid", "Shipped", "new"},
	)
}

func order(t testing.TB, tbl *Grid) []int32 {
	t.Helper()
	v := tbl.View(0, tbl.RowCount())
	return append([]int32(nil), v.RowIDs...)
}

/* ------------------------------------------------------------------ */
/* Sort                                                                */
/* ------------------------------------------------------------------ */

func TestSortSingleColumn(t *testing.T) {
	cases := []struct {
		name string
		sort []SortKey
		want []int32
	}{
		{"f64 ascending", []SortKey{{Col: 1}}, []int32{1, 3, 2, 0, 4}},
		{"f64 descending", []SortKey{{Col: 1, Desc: true}}, []int32{4, 0, 2, 1, 3}},
		{"i32 ascending", []SortKey{{Col: 0}}, []int32{0, 1, 2, 3, 4}},
		{"i32 descending", []SortKey{{Col: 0, Desc: true}}, []int32{4, 3, 2, 1, 0}},
		// Case-insensitive, so "Shipped" sorts with the other s words
		// rather than above everything.
		{"string ascending", []SortKey{{Col: 2}}, []int32{1, 4, 0, 2, 3}},
		{"string descending", []SortKey{{Col: 2, Desc: true}}, []int32{3, 0, 2, 1, 4}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for _, mode := range []sortMode{sortRadix, sortCompare} {
				tbl := queryGrid(t)
				tbl.sortMode = mode
				if err := tbl.SetQuery(Query{Sort: tc.sort}); err != nil {
					t.Fatalf("SetQuery: %v", err)
				}
				if got := order(t, tbl); !equalI32(got, tc.want) {
					t.Fatalf("mode %d: order = %v, want %v", mode, got, tc.want)
				}
			}
		})
	}
}

func TestSortIsStableAndTiesBreakByRowID(t *testing.T) {
	// Rows 1 and 3 both have price 10; row 1 must stay first.
	for _, mode := range []sortMode{sortRadix, sortCompare} {
		tbl := queryGrid(t)
		tbl.sortMode = mode
		if err := tbl.SetQuery(Query{Sort: []SortKey{{Col: 1}}}); err != nil {
			t.Fatalf("SetQuery: %v", err)
		}
		got := order(t, tbl)
		if got[0] != 1 || got[1] != 3 {
			t.Fatalf("mode %d: ties = %v, want row 1 before row 3", mode, got[:2])
		}
	}
}

func TestSortDescendingKeepsTiesInRowIDOrder(t *testing.T) {
	// Descending inverts the key, not the tie-break: equal values still
	// come back in id order.
	for _, mode := range []sortMode{sortRadix, sortCompare} {
		tbl := queryGrid(t)
		tbl.sortMode = mode
		if err := tbl.SetQuery(Query{Sort: []SortKey{{Col: 1, Desc: true}}}); err != nil {
			t.Fatalf("SetQuery: %v", err)
		}
		got := order(t, tbl)
		if got[3] != 1 || got[4] != 3 {
			t.Fatalf("mode %d: ties = %v, want row 1 before row 3", mode, got[3:])
		}
	}
}

func TestMultiColumnSort(t *testing.T) {
	// status ascending, then price descending within each status.
	//   "new":     4 (40), 1 (10)
	//   "paid":    0 (30), 2 (20)
	//   "Shipped": 3
	want := []int32{4, 1, 0, 2, 3}

	for _, mode := range []sortMode{sortRadix, sortCompare} {
		tbl := queryGrid(t)
		tbl.sortMode = mode
		if err := tbl.SetQuery(Query{
			Sort: []SortKey{{Col: 2}, {Col: 1, Desc: true}},
		}); err != nil {
			t.Fatalf("SetQuery: %v", err)
		}
		if got := order(t, tbl); !equalI32(got, want) {
			t.Fatalf("mode %d: order = %v, want %v", mode, got, want)
		}
	}
}

func TestBothSortsAgreeOnLargerData(t *testing.T) {
	const n = 2000
	ids := make([]int32, n)
	prices := make([]float64, n)
	statuses := make([]string, n)
	labels := []string{"new", "paid", "picked", "shipped", "held"}
	for i := range ids {
		ids[i] = int32((i * 7919) % 101)
		prices[i] = float64((i*31)%53) - 20
		statuses[i] = labels[i%len(labels)]
	}

	sorts := [][]SortKey{
		{{Col: 0}},
		{{Col: 1, Desc: true}},
		{{Col: 2}},
		{{Col: 2}, {Col: 1}},
		{{Col: 1}, {Col: 0, Desc: true}},
	}

	for i, sort := range sorts {
		radix := seeded(t, ids, prices, statuses)
		radix.sortMode = sortRadix
		if err := radix.SetQuery(Query{Sort: sort}); err != nil {
			t.Fatalf("SetQuery: %v", err)
		}

		compare := seeded(t, ids, prices, statuses)
		compare.sortMode = sortCompare
		if err := compare.SetQuery(Query{Sort: sort}); err != nil {
			t.Fatalf("SetQuery: %v", err)
		}

		if !equalI32(order(t, radix), order(t, compare)) {
			t.Fatalf("sort %d: the two implementations disagree", i)
		}
	}
}

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

func TestNumericFilters(t *testing.T) {
	cases := []struct {
		name string
		f    Filter
		want []int32
	}{
		{"eq", Filter{Col: 1, Op: OpEq, Number: 10}, []int32{1, 3}},
		{"ne", Filter{Col: 1, Op: OpNe, Number: 10}, []int32{0, 2, 4}},
		{"lt", Filter{Col: 1, Op: OpLt, Number: 20}, []int32{1, 3}},
		{"le", Filter{Col: 1, Op: OpLe, Number: 20}, []int32{1, 2, 3}},
		{"gt", Filter{Col: 1, Op: OpGt, Number: 20}, []int32{0, 4}},
		{"ge", Filter{Col: 1, Op: OpGe, Number: 20}, []int32{0, 2, 4}},
		{"between", Filter{Col: 1, Op: OpBetween, Number: 10, Upper: 20}, []int32{1, 2, 3}},
		{"between matching one", Filter{Col: 1, Op: OpBetween, Number: 40, Upper: 40}, []int32{4}},
		{"matches nothing", Filter{Col: 1, Op: OpGt, Number: 999}, nil},
		// An i32 column compares the same way.
		{"i32 ge", Filter{Col: 0, Op: OpGe, Number: 300}, []int32{2, 3, 4}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tbl := queryGrid(t)
			if err := tbl.SetQuery(Query{Filters: []Filter{tc.f}}); err != nil {
				t.Fatalf("SetQuery: %v", err)
			}
			if got := order(t, tbl); !equalI32(got, tc.want) {
				t.Fatalf("order = %v, want %v", got, tc.want)
			}
			if int(tbl.RowCount()) != len(tc.want) {
				t.Fatalf("RowCount() = %d, want %d", tbl.RowCount(), len(tc.want))
			}
		})
	}
}

func TestStringFilters(t *testing.T) {
	cases := []struct {
		name string
		f    Filter
		want []int32
	}{
		{"eq", Filter{Col: 2, Op: OpEq, Text: "paid"}, []int32{0, 2}},
		{"ne", Filter{Col: 2, Op: OpNe, Text: "paid"}, []int32{1, 3, 4}},
		{"eq on a value nothing holds", Filter{Col: 2, Op: OpEq, Text: "void"}, nil},
		{"ne on a value nothing holds", Filter{Col: 2, Op: OpNe, Text: "void"}, []int32{0, 1, 2, 3, 4}},
		{"in", Filter{Col: 2, Op: OpIn, List: []string{"new", "paid"}}, []int32{0, 1, 2, 4}},
		{"in with an unknown value", Filter{Col: 2, Op: OpIn, List: []string{"new", "void"}}, []int32{1, 4}},
		{"in nothing", Filter{Col: 2, Op: OpIn, List: nil}, nil},
		// Case-insensitive: "Shipped" matches "ship".
		{"contains", Filter{Col: 2, Op: OpContains, Text: "ship"}, []int32{3}},
		{"contains uppercase needle", Filter{Col: 2, Op: OpContains, Text: "SHIP"}, []int32{3}},
		{"contains matching several", Filter{Col: 2, Op: OpContains, Text: "p"}, []int32{0, 2, 3}},
		{"contains nothing matches all", Filter{Col: 2, Op: OpContains, Text: ""}, []int32{0, 1, 2, 3, 4}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tbl := queryGrid(t)
			if err := tbl.SetQuery(Query{Filters: []Filter{tc.f}}); err != nil {
				t.Fatalf("SetQuery: %v", err)
			}
			if got := order(t, tbl); !equalI32(got, tc.want) {
				t.Fatalf("order = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestFiltersCombineWithAnd(t *testing.T) {
	tbl := queryGrid(t)
	if err := tbl.SetQuery(Query{Filters: []Filter{
		{Col: 2, Op: OpEq, Text: "paid"},
		{Col: 1, Op: OpGt, Number: 25},
	}}); err != nil {
		t.Fatalf("SetQuery: %v", err)
	}
	if got := order(t, tbl); !equalI32(got, []int32{0}) {
		t.Fatalf("order = %v, want [0]", got)
	}
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

func TestSearch(t *testing.T) {
	cases := []struct {
		name string
		text string
		want []int32
	}{
		{"matches one", "ship", []int32{3}},
		{"case-insensitive", "SHIP", []int32{3}},
		{"matches several", "p", []int32{0, 2, 3}},
		{"matches nothing", "zzz", nil},
		{"empty searches nothing away", "", []int32{0, 1, 2, 3, 4}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tbl := queryGrid(t)
			if err := tbl.SetQuery(Query{Search: tc.text}); err != nil {
				t.Fatalf("SetQuery: %v", err)
			}
			if got := order(t, tbl); !equalI32(got, tc.want) {
				t.Fatalf("order = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestSearchCoversEveryStringColumn(t *testing.T) {
	tbl := newTestGrid(t, Schema{
		{Name: "a", Type: String},
		{Name: "b", Type: String},
		{Name: "n", Type: I32},
	})
	if _, err := tbl.InsertColumns([]ColumnData{
		{Strings: []string{"alpha", "beta", "gamma"}},
		{Strings: []string{"xx", "needle", "yy"}},
		{I32: []int32{1, 2, 3}},
	}); err != nil {
		t.Fatalf("InsertColumns: %v", err)
	}

	// A hit in the second column is still a hit.
	if err := tbl.SetQuery(Query{Search: "needle"}); err != nil {
		t.Fatalf("SetQuery: %v", err)
	}
	if got := order(t, tbl); !equalI32(got, []int32{1}) {
		t.Fatalf("order = %v, want [1]", got)
	}

	// Numbers are not searched: "2" is in column n and matches nothing.
	if err := tbl.SetQuery(Query{Search: "2"}); err != nil {
		t.Fatalf("SetQuery: %v", err)
	}
	if got := tbl.RowCount(); got != 0 {
		t.Fatalf("RowCount() = %d, want 0: numeric columns are not searched", got)
	}
}

/* ------------------------------------------------------------------ */
/* All three together                                                  */
/* ------------------------------------------------------------------ */

func TestFilterSearchAndSortTogether(t *testing.T) {
	tbl := queryGrid(t)

	// Filter to price >= 20, search for "a", then sort by price descending.
	//   price >= 20: rows 0 (30, paid), 2 (20, paid), 4 (40, new)
	//   search "a":  "paid" has one, "new" does not, so row 4 drops
	//   sort desc:   0 (30), 2 (20)
	if err := tbl.SetQuery(Query{
		Filters: []Filter{{Col: 1, Op: OpGe, Number: 20}},
		Search:  "a",
		Sort:    []SortKey{{Col: 1, Desc: true}},
	}); err != nil {
		t.Fatalf("SetQuery: %v", err)
	}
	if got := order(t, tbl); !equalI32(got, []int32{0, 2}) {
		t.Fatalf("order = %v, want [0 2]", got)
	}

	// Dropping the search lets row 4 back in, at the top.
	if err := tbl.SetQuery(Query{
		Filters: []Filter{{Col: 1, Op: OpGe, Number: 20}},
		Sort:    []SortKey{{Col: 1, Desc: true}},
	}); err != nil {
		t.Fatalf("SetQuery: %v", err)
	}
	if got := order(t, tbl); !equalI32(got, []int32{4, 0, 2}) {
		t.Fatalf("order = %v, want [4 0 2]", got)
	}
}

func TestQueryPersistsAcrossMutations(t *testing.T) {
	tbl := queryGrid(t)
	if err := tbl.SetQuery(Query{Sort: []SortKey{{Col: 1}}}); err != nil {
		t.Fatalf("SetQuery: %v", err)
	}

	// A new row lands where the sort says, not at the end.
	if _, err := tbl.InsertColumns([]ColumnData{
		{I32: []int32{600}}, {F64: []float64{15}}, {Strings: []string{"new"}},
	}); err != nil {
		t.Fatalf("InsertColumns: %v", err)
	}
	if got := order(t, tbl); !equalI32(got, []int32{1, 3, 5, 2, 0, 4}) {
		t.Fatalf("order = %v, want [1 3 5 2 0 4]", got)
	}

	// And a delete just drops out of it.
	if err := tbl.DeleteRows([]int32{3}); err != nil {
		t.Fatalf("DeleteRows: %v", err)
	}
	if got := order(t, tbl); !equalI32(got, []int32{1, 5, 2, 0, 4}) {
		t.Fatalf("order = %v, want [1 5 2 0 4]", got)
	}
}

func TestEditMovesARowUnderAnActiveSort(t *testing.T) {
	tbl := queryGrid(t)
	if err := tbl.SetQuery(Query{Sort: []SortKey{{Col: 1}}}); err != nil {
		t.Fatalf("SetQuery: %v", err)
	}
	if got := order(t, tbl); !equalI32(got, []int32{1, 3, 2, 0, 4}) {
		t.Fatalf("order = %v, want [1 3 2 0 4]", got)
	}

	// Row 1 was cheapest; make it dearest.
	if err := tbl.SetF64(1, 1, 99); err != nil {
		t.Fatalf("SetF64: %v", err)
	}
	if got := order(t, tbl); !equalI32(got, []int32{3, 2, 0, 4, 1}) {
		t.Fatalf("order = %v, want [3 2 0 4 1]", got)
	}
}

func TestEditMovesARowOutOfAFilter(t *testing.T) {
	tbl := queryGrid(t)
	if err := tbl.SetQuery(Query{Filters: []Filter{{Col: 2, Op: OpEq, Text: "paid"}}}); err != nil {
		t.Fatalf("SetQuery: %v", err)
	}
	if got := order(t, tbl); !equalI32(got, []int32{0, 2}) {
		t.Fatalf("order = %v, want [0 2]", got)
	}

	if err := tbl.SetString(0, 2, "refunded"); err != nil {
		t.Fatalf("SetString: %v", err)
	}
	if got := order(t, tbl); !equalI32(got, []int32{2}) {
		t.Fatalf("order = %v, want [2]: the edited row should drop out", got)
	}

	// And back in.
	if err := tbl.SetString(1, 2, "paid"); err != nil {
		t.Fatalf("SetString: %v", err)
	}
	if got := order(t, tbl); !equalI32(got, []int32{1, 2}) {
		t.Fatalf("order = %v, want [1 2]", got)
	}
}

/* ------------------------------------------------------------------ */
/* The rebuild skip                                                    */
/* ------------------------------------------------------------------ */

func TestRebuildSkipFollowsTheQuery(t *testing.T) {
	cases := []struct {
		name     string
		query    Query
		col      int32
		wantSkip bool
	}{
		{"no query at all", Query{}, 1, true},
		{"sorted on another column", Query{Sort: []SortKey{{Col: 0}}}, 1, true},
		{"sorted on this column", Query{Sort: []SortKey{{Col: 1}}}, 1, false},
		{"filtered on another column", Query{Filters: []Filter{{Col: 0, Op: OpGt}}}, 1, true},
		{"filtered on this column", Query{Filters: []Filter{{Col: 1, Op: OpGt}}}, 1, false},
		// Search reads every string column, so any string edit matters.
		{"searching, numeric edit", Query{Search: "p"}, 1, true},
		{"searching, string edit", Query{Search: "p"}, 2, false},
		{"not searching, string edit", Query{}, 2, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tbl := queryGrid(t)
			if err := tbl.SetQuery(tc.query); err != nil {
				t.Fatalf("SetQuery: %v", err)
			}

			// Scribble on the order: a skipped rebuild leaves it alone.
			if len(tbl.order) == 0 {
				t.Fatal("the query matched nothing, so this proves nothing")
			}
			tbl.order[0] = 99
			switch tbl.cols[tc.col].typ {
			case String:
				if err := tbl.SetString(0, tc.col, "zzz"); err != nil {
					t.Fatalf("SetString: %v", err)
				}
			case F64:
				if err := tbl.SetF64(0, tc.col, 7); err != nil {
					t.Fatalf("SetF64: %v", err)
				}
			default:
				if err := tbl.SetI32(0, tc.col, 7); err != nil {
					t.Fatalf("SetI32: %v", err)
				}
			}

			skipped := len(tbl.order) > 0 && tbl.order[0] == 99
			if skipped != tc.wantSkip {
				t.Fatalf("skipped = %v, want %v", skipped, tc.wantSkip)
			}
		})
	}
}

/* ------------------------------------------------------------------ */
/* Validation and revisions                                            */
/* ------------------------------------------------------------------ */

func TestSetQueryRejectsAndKeepsThePrevious(t *testing.T) {
	cases := []struct {
		name  string
		query Query
		want  error
	}{
		{"sort column past the end", Query{Sort: []SortKey{{Col: 9}}}, ErrNoSuchColumn},
		{"negative sort column", Query{Sort: []SortKey{{Col: -1}}}, ErrNoSuchColumn},
		{"filter column past the end", Query{Filters: []Filter{{Col: 9, Op: OpEq}}}, ErrNoSuchColumn},
		{"numeric op on a string column", Query{Filters: []Filter{{Col: 2, Op: OpLt}}}, ErrWrongType},
		{"string op on a numeric column", Query{Filters: []Filter{{Col: 1, Op: OpContains}}}, ErrWrongType},
		{"in on a numeric column", Query{Filters: []Filter{{Col: 0, Op: OpIn}}}, ErrWrongType},
		{
			"between with the bounds the wrong way round",
			Query{Filters: []Filter{{Col: 1, Op: OpBetween, Number: 50, Upper: 10}}},
			ErrBadRange,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tbl := queryGrid(t)
			if err := tbl.SetQuery(Query{Sort: []SortKey{{Col: 1, Desc: true}}}); err != nil {
				t.Fatalf("SetQuery: %v", err)
			}
			before := order(t, tbl)
			rev := tbl.Revision()

			if err := tbl.SetQuery(tc.query); !errors.Is(err, tc.want) {
				t.Fatalf("SetQuery = %v, want %v", err, tc.want)
			}
			if got := order(t, tbl); !equalI32(got, before) {
				t.Fatalf("a rejected query changed the order to %v", got)
			}
			if tbl.Revision() != rev {
				t.Fatalf("a rejected query bumped the revision")
			}
			if len(tbl.Query().Sort) != 1 {
				t.Fatalf("a rejected query replaced the previous one")
			}
		})
	}
}

func TestSetQueryBumpsOnlyOnAChange(t *testing.T) {
	tbl := queryGrid(t)
	q := Query{Sort: []SortKey{{Col: 1}}, Filters: []Filter{{Col: 1, Op: OpGt, Number: 5}}}

	if err := tbl.SetQuery(q); err != nil {
		t.Fatalf("SetQuery: %v", err)
	}
	after := tbl.Revision()

	// The same query again changes nothing anyone has to re-render for.
	if err := tbl.SetQuery(q); err != nil {
		t.Fatalf("SetQuery: %v", err)
	}
	if tbl.Revision() != after {
		t.Fatalf("setting the same query bumped the revision")
	}

	if err := tbl.SetQuery(Query{Sort: []SortKey{{Col: 1, Desc: true}}}); err != nil {
		t.Fatalf("SetQuery: %v", err)
	}
	if tbl.Revision() == after {
		t.Fatalf("a different query did not bump the revision")
	}
}

func TestEmptyQueryRestoresIDOrder(t *testing.T) {
	tbl := queryGrid(t)
	if err := tbl.SetQuery(Query{Sort: []SortKey{{Col: 1, Desc: true}}, Search: "a"}); err != nil {
		t.Fatalf("SetQuery: %v", err)
	}
	if err := tbl.SetQuery(Query{}); err != nil {
		t.Fatalf("SetQuery: %v", err)
	}
	if got := order(t, tbl); !equalI32(got, []int32{0, 1, 2, 3, 4}) {
		t.Fatalf("order = %v, want id order", got)
	}
}

func TestQueryReadsBackWhatWasSet(t *testing.T) {
	tbl := queryGrid(t)
	q := Query{
		Sort:    []SortKey{{Col: 1, Desc: true}, {Col: 0}},
		Filters: []Filter{{Col: 2, Op: OpIn, List: []string{"new", "paid"}}},
		Search:  "a",
	}
	if err := tbl.SetQuery(q); err != nil {
		t.Fatalf("SetQuery: %v", err)
	}

	got := tbl.Query()
	if len(got.Sort) != 2 || got.Sort[0] != (SortKey{Col: 1, Desc: true}) {
		t.Fatalf("Sort = %v", got.Sort)
	}
	if len(got.Filters) != 1 || got.Filters[0].Op != OpIn {
		t.Fatalf("Filters = %v", got.Filters)
	}
	if got.Search != "a" {
		t.Fatalf("Search = %q", got.Search)
	}

	// A copy: editing it must not reach into the grid.
	got.Sort[0].Desc = false
	if tbl.Query().Sort[0].Desc != true {
		t.Fatal("Query() handed back the grid's own slice")
	}
}

/* ------------------------------------------------------------------ */
/* Dictionary growth                                                   */
/* ------------------------------------------------------------------ */

func TestDictionaryGrowthInvalidatesTheRankCache(t *testing.T) {
	tbl := queryGrid(t)
	if err := tbl.SetQuery(Query{Sort: []SortKey{{Col: 2}}}); err != nil {
		t.Fatalf("SetQuery: %v", err)
	}
	// new, new, paid, paid, Shipped
	if got := order(t, tbl); !equalI32(got, []int32{1, 4, 0, 2, 3}) {
		t.Fatalf("order = %v", got)
	}

	// "AAA" is a new dictionary entry and sorts before every existing one,
	// so the ranks built a moment ago are stale.
	if err := tbl.SetString(0, 2, "AAA"); err != nil {
		t.Fatalf("SetString: %v", err)
	}
	if got := order(t, tbl); !equalI32(got, []int32{0, 1, 4, 2, 3}) {
		t.Fatalf("order = %v, want the new value first", got)
	}
}

func TestDictionaryGrowthInvalidatesTheMatchCaches(t *testing.T) {
	t.Run("filter", func(t *testing.T) {
		tbl := queryGrid(t)
		if err := tbl.SetQuery(Query{
			Filters: []Filter{{Col: 2, Op: OpContains, Text: "e"}},
		}); err != nil {
			t.Fatalf("SetQuery: %v", err)
		}
		// "new" twice, "Shipped" once.
		if got := order(t, tbl); !equalI32(got, []int32{1, 3, 4}) {
			t.Fatalf("order = %v, want [1 3 4]", got)
		}

		// A value the column has never held, which does contain an "e".
		if err := tbl.SetString(0, 2, "deferred"); err != nil {
			t.Fatalf("SetString: %v", err)
		}
		if got := order(t, tbl); !equalI32(got, []int32{0, 1, 3, 4}) {
			t.Fatalf("order = %v, want the new value included", got)
		}
	})

	t.Run("search", func(t *testing.T) {
		tbl := queryGrid(t)
		if err := tbl.SetQuery(Query{Search: "zz"}); err != nil {
			t.Fatalf("SetQuery: %v", err)
		}
		if got := tbl.RowCount(); got != 0 {
			t.Fatalf("RowCount() = %d, want 0", got)
		}

		if err := tbl.SetString(2, 2, "fizzle"); err != nil {
			t.Fatalf("SetString: %v", err)
		}
		if got := order(t, tbl); !equalI32(got, []int32{2}) {
			t.Fatalf("order = %v, want [2]", got)
		}
	})
}

func TestLowerASCII(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", ""},
		{"abc", "abc"},
		{"ABC", "abc"},
		{"MiXeD", "mixed"},
		{"with 123", "with 123"},
		// Non-ASCII is left alone rather than folded.
		{"caf\xc3\x89", "caf\xc3\x89"},
	}
	for _, tc := range cases {
		if got := lowerASCII(tc.in); got != tc.want {
			t.Errorf("lowerASCII(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestContainsASCII(t *testing.T) {
	cases := []struct {
		haystack, needle string
		want             bool
	}{
		{"shipped", "ship", true},
		{"shipped", "ped", true},
		{"shipped", "ipp", true},
		{"shipped", "zz", false},
		{"shipped", "", true},
		{"", "a", false},
		{"ab", "abc", false},
		{"aab", "ab", true},
	}
	for _, tc := range cases {
		if got := containsASCII(tc.haystack, tc.needle); got != tc.want {
			t.Errorf("containsASCII(%q, %q) = %v", tc.haystack, tc.needle, got)
		}
	}
}

func TestSortAllocatesNothingWhenRepeated(t *testing.T) {
	tbl := seeded(t,
		make([]int32, 500), make([]float64, 500),
		func() []string {
			out := make([]string, 500)
			for i := range out {
				out[i] = "s"
			}
			return out
		}(),
	)
	if err := tbl.SetQuery(Query{Sort: []SortKey{{Col: 1}}}); err != nil {
		t.Fatalf("SetQuery: %v", err)
	}

	// The scratch is grid-owned and sized on the first pass.
	allocs := testing.AllocsPerRun(50, func() { tbl.rebuildOrder() })
	if allocs != 0 {
		t.Fatalf("rebuildOrder allocated %v times per run, want 0", allocs)
	}
}

func TestStringSortIgnoresCase(t *testing.T) {
	tbl := newTestGrid(t, Schema{{Name: "name", Type: String}})
	if _, err := tbl.InsertColumns([]ColumnData{
		{Strings: []string{"Zed", "alice", "Bob", "carol", "ALICE"}},
	}); err != nil {
		t.Fatalf("InsertColumns: %v", err)
	}
	if err := tbl.SetQuery(Query{Sort: []SortKey{{Col: 0}}}); err != nil {
		t.Fatalf("SetQuery: %v", err)
	}

	// ALICE, alice, Bob, carol, Zed: folded order, with byte order
	// settling the two spellings of the same name. Plain byte order would
	// have put every capitalised name above every lowercase one.
	dict, _ := tbl.DictSince(0, 0)
	v := tbl.View(0, 5)
	got := make([]string, 5)
	for i, id := range v.Cols[0].I32 {
		got[i] = dict[id]
	}
	if !equalStrings(got, []string{"ALICE", "alice", "Bob", "carol", "Zed"}) {
		t.Fatalf("order = %v", got)
	}
}

func TestStringSortBreaksCaseTiesByByteOrder(t *testing.T) {
	tbl := newTestGrid(t, Schema{{Name: "name", Type: String}})
	if _, err := tbl.InsertColumns([]ColumnData{
		{Strings: []string{"bob", "BOB", "Bob"}},
	}); err != nil {
		t.Fatalf("InsertColumns: %v", err)
	}
	if err := tbl.SetQuery(Query{Sort: []SortKey{{Col: 0}}}); err != nil {
		t.Fatalf("SetQuery: %v", err)
	}

	// All three fold to "bob", so byte order settles it: uppercase first.
	dict, _ := tbl.DictSince(0, 0)
	v := tbl.View(0, 3)
	got := make([]string, 3)
	for i, id := range v.Cols[0].I32 {
		got[i] = dict[id]
	}
	if !equalStrings(got, []string{"BOB", "Bob", "bob"}) {
		t.Fatalf("order = %v, want BOB, Bob, bob", got)
	}
}

func TestLowercaseMirrorGrowsWithTheDictionary(t *testing.T) {
	tbl := newTestGrid(t, Schema{{Name: "name", Type: String}})
	if _, err := tbl.InsertColumns([]ColumnData{{Strings: []string{"Alpha", "BETA"}}}); err != nil {
		t.Fatalf("InsertColumns: %v", err)
	}

	// Built as entries arrive, not on first use, so a search never pays
	// for a column it has not searched before.
	c := &tbl.cols[0]
	if !equalStrings(c.dict.lower, []string{"alpha", "beta"}) {
		t.Fatalf("lower = %v", c.dict.lower)
	}

	if err := tbl.SetString(0, 0, "Gamma"); err != nil {
		t.Fatalf("SetString: %v", err)
	}
	if !equalStrings(c.dict.lower, []string{"alpha", "beta", "gamma"}) {
		t.Fatalf("lower = %v after an edit", c.dict.lower)
	}
}

func TestSettingAnEmptyQueryOnAFreshGridChangesNothing(t *testing.T) {
	tbl := queryGrid(t)
	before := tbl.Revision()

	// The grid already has no query. Saying so again is not a change
	// anyone has to re-render for.
	if err := tbl.SetQuery(Query{}); err != nil {
		t.Fatalf("SetQuery: %v", err)
	}
	if tbl.Revision() != before {
		t.Fatalf("Revision() = %d, want %d", tbl.Revision(), before)
	}
}
