package table

import (
	"errors"
	"testing"
)

func TestViewWindows(t *testing.T) {
	tbl := fourRows(t)

	cases := []struct {
		name      string
		start     int32
		count     int32
		wantStart int32
		wantIDs   []int32
	}{
		{"whole table", 0, 4, 0, []int32{0, 1, 2, 3}},
		{"first page", 0, 2, 0, []int32{0, 1}},
		{"middle", 1, 2, 1, []int32{1, 2}},
		{"last row", 3, 1, 3, []int32{3}},
		{"count past the end clamps", 2, 100, 2, []int32{2, 3}},
		{"start at the end is empty", 4, 10, 4, nil},
		{"start past the end clamps to the end", 99, 10, 4, nil},
		{"negative start reads from zero", -5, 2, 0, []int32{0, 1}},
		{"negative count is empty", 1, -3, 1, nil},
		{"zero count is empty", 1, 0, 1, nil},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			v := tbl.View(tc.start, tc.count)

			if v.Start != tc.wantStart {
				t.Errorf("Start = %d, want %d", v.Start, tc.wantStart)
			}
			if !equalI32(v.RowIDs, tc.wantIDs) {
				t.Errorf("RowIDs = %v, want %v", v.RowIDs, tc.wantIDs)
			}
			// Every column is always present and always the same length as
			// RowIDs, so a caller can index it without checking.
			if len(v.Cols) != 3 {
				t.Fatalf("Cols has %d entries, want 3", len(v.Cols))
			}
			for i, c := range v.Cols {
				n := len(c.I32) + len(c.F64)
				if n != len(v.RowIDs) {
					t.Errorf("col %d has %d values, want %d", i, n, len(v.RowIDs))
				}
			}
		})
	}
}

func TestViewColumnTypes(t *testing.T) {
	v := fourRows(t).View(0, 4)

	cases := []struct {
		col     int
		typ     ColumnType
		wantI32 bool
		wantF64 bool
	}{
		{0, I32, true, false},
		{1, F64, false, true},
		// A string column reports dictionary ids, so it comes back in I32.
		{2, String, true, false},
	}

	for _, tc := range cases {
		c := v.Cols[tc.col]
		if c.Type != tc.typ {
			t.Errorf("col %d Type = %v, want %v", tc.col, c.Type, tc.typ)
		}
		if (c.I32 != nil) != tc.wantI32 {
			t.Errorf("col %d I32 set = %v, want %v", tc.col, c.I32 != nil, tc.wantI32)
		}
		if (c.F64 != nil) != tc.wantF64 {
			t.Errorf("col %d F64 set = %v, want %v", tc.col, c.F64 != nil, tc.wantF64)
		}
	}
}

func TestViewOfAnEmptyTableNeverPanics(t *testing.T) {
	tbl := newTestTable(t, testSchema())

	for _, tc := range []struct{ start, count int32 }{
		{0, 0}, {0, 50}, {-1, 50}, {99, 50}, {0, -1},
	} {
		v := tbl.View(tc.start, tc.count)
		if len(v.RowIDs) != 0 {
			t.Errorf("View(%d, %d) returned %d rows", tc.start, tc.count, len(v.RowIDs))
		}
		if len(v.Cols) != 3 {
			t.Errorf("View(%d, %d) returned %d columns", tc.start, tc.count, len(v.Cols))
		}
	}
}

func TestViewReturnsCopies(t *testing.T) {
	tbl := fourRows(t)
	v := tbl.View(0, 4)

	// The caller owns what View hands back; writing to it must not reach
	// the table's own storage.
	v.RowIDs[0] = 999
	v.Cols[0].I32[0] = 999

	again := tbl.View(0, 4)
	if again.RowIDs[0] != 0 || again.Cols[0].I32[0] != 10 {
		t.Fatalf("mutating a view changed the table: ids[0]=%d col0[0]=%d",
			again.RowIDs[0], again.Cols[0].I32[0])
	}
}

func TestViewFollowsTheOrderNotTheIDs(t *testing.T) {
	tbl := fourRows(t)
	if err := tbl.DeleteRows([]int32{0, 2}); err != nil {
		t.Fatalf("DeleteRows: %v", err)
	}

	// start is an offset into the live order, not a row id.
	v := tbl.View(1, 1)
	if !equalI32(v.RowIDs, []int32{3}) {
		t.Fatalf("RowIDs = %v, want [3]", v.RowIDs)
	}
	if !equalI32(v.Cols[0].I32, []int32{40}) {
		t.Fatalf("col 0 = %v, want [40]", v.Cols[0].I32)
	}
}

func TestDictionaryReuseAndGrowth(t *testing.T) {
	tbl := seeded(t,
		[]int32{1, 2, 3, 4},
		[]float64{1, 2, 3, 4},
		[]string{"new", "shipped", "new", "shipped"},
	)

	dict, err := tbl.DictSince(2, 0)
	if err != nil {
		t.Fatalf("DictSince: %v", err)
	}
	// Two distinct labels over four rows: a repeat reuses its id rather
	// than appending, which is the whole point of the encoding.
	if !equalStrings(dict, []string{"new", "shipped"}) {
		t.Fatalf("dictionary = %v, want [new shipped]", dict)
	}

	v := tbl.View(0, 4)
	if !equalI32(v.Cols[2].I32, []int32{0, 1, 0, 1}) {
		t.Fatalf("ids = %v, want [0 1 0 1]", v.Cols[2].I32)
	}
}

func TestDictionaryIsAppendOnly(t *testing.T) {
	tbl := fourRows(t) // new, shipped, new, held

	n, err := tbl.DictLen(2)
	if err != nil {
		t.Fatalf("DictLen: %v", err)
	}
	if n != 3 {
		t.Fatalf("DictLen() = %d, want 3", n)
	}

	// Overwrite the only cell holding "held". The entry stays: ids already
	// handed to JS must never change meaning.
	if err := tbl.SetString(3, 2, "new"); err != nil {
		t.Fatalf("SetString: %v", err)
	}

	after, _ := tbl.DictLen(2)
	if after != 3 {
		t.Fatalf("DictLen() = %d after overwriting the last use of a value, want 3", after)
	}
	dict, _ := tbl.DictSince(2, 0)
	if !equalStrings(dict, []string{"new", "shipped", "held"}) {
		t.Fatalf("dictionary = %v, want [new shipped held]", dict)
	}

	// A value the column has never held does append.
	if err := tbl.SetString(0, 2, "cancelled"); err != nil {
		t.Fatalf("SetString: %v", err)
	}
	if n, _ := tbl.DictLen(2); n != 4 {
		t.Fatalf("DictLen() = %d after a new value, want 4", n)
	}
}

func TestDictSince(t *testing.T) {
	tbl := fourRows(t) // dictionary: new, shipped, held

	cases := []struct {
		name string
		from int32
		want []string
	}{
		{"everything", 0, []string{"new", "shipped", "held"}},
		{"since the first", 1, []string{"shipped", "held"}},
		{"since the last", 2, []string{"held"}},
		{"already current", 3, nil},
		{"mirror somehow ahead", 99, nil},
		{"negative clamps to zero", -1, []string{"new", "shipped", "held"}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := tbl.DictSince(2, tc.from)
			if err != nil {
				t.Fatalf("DictSince: %v", err)
			}
			if !equalStrings(got, tc.want) {
				t.Fatalf("DictSince(2, %d) = %v, want %v", tc.from, got, tc.want)
			}
		})
	}
}

func TestDictSinceDrivesAnIncrementalMirror(t *testing.T) {
	tbl := seeded(t, []int32{1}, []float64{1}, []string{"a"})

	// What JS does: keep the entries seen so far, ask only for the rest.
	mirror := []string{}
	sync := func() {
		added, err := tbl.DictSince(2, int32(len(mirror)))
		if err != nil {
			t.Fatalf("DictSince: %v", err)
		}
		mirror = append(mirror, added...)
	}

	sync()
	if !equalStrings(mirror, []string{"a"}) {
		t.Fatalf("mirror = %v, want [a]", mirror)
	}

	if _, err := tbl.InsertColumns([]ColumnData{
		{I32: []int32{2, 3}}, {F64: []float64{2, 3}}, {Strings: []string{"b", "a"}},
	}); err != nil {
		t.Fatalf("InsertColumns: %v", err)
	}

	sync()
	// "a" was already mirrored and must not be re-sent.
	if !equalStrings(mirror, []string{"a", "b"}) {
		t.Fatalf("mirror = %v, want [a b]", mirror)
	}

	// Every id in the table resolves against the mirror.
	v := tbl.View(0, 3)
	for i, id := range v.Cols[2].I32 {
		if id < 0 || int(id) >= len(mirror) {
			t.Fatalf("row %d has id %d, outside a mirror of %d entries", i, id, len(mirror))
		}
	}
}

func TestDictionariesArePerColumn(t *testing.T) {
	tbl := newTestTable(t, Schema{
		{Name: "a", Type: String},
		{Name: "b", Type: String},
	})
	if _, err := tbl.InsertColumns([]ColumnData{
		{Strings: []string{"x", "y"}},
		{Strings: []string{"y", "z"}},
	}); err != nil {
		t.Fatalf("InsertColumns: %v", err)
	}

	a, _ := tbl.DictSince(0, 0)
	b, _ := tbl.DictSince(1, 0)
	if !equalStrings(a, []string{"x", "y"}) {
		t.Fatalf("column a dictionary = %v, want [x y]", a)
	}
	if !equalStrings(b, []string{"y", "z"}) {
		t.Fatalf("column b dictionary = %v, want [y z]", b)
	}

	// "y" is id 1 in column a and id 0 in column b: ids are only meaningful
	// against their own column's dictionary.
	v := tbl.View(0, 2)
	if v.Cols[0].I32[1] != 1 || v.Cols[1].I32[0] != 0 {
		t.Fatalf("ids = %v / %v", v.Cols[0].I32, v.Cols[1].I32)
	}
}

func TestDictionaryAccessorsRejectBadColumns(t *testing.T) {
	tbl := fourRows(t)

	cases := []struct {
		name string
		col  int32
		want error
	}{
		{"negative", -1, ErrNoSuchColumn},
		{"past the end", 3, ErrNoSuchColumn},
		{"not a string column", 0, ErrWrongType},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := tbl.DictSince(tc.col, 0); !errors.Is(err, tc.want) {
				t.Errorf("DictSince = %v, want %v", err, tc.want)
			}
			if _, err := tbl.DictLen(tc.col); !errors.Is(err, tc.want) {
				t.Errorf("DictLen = %v, want %v", err, tc.want)
			}
		})
	}
}
