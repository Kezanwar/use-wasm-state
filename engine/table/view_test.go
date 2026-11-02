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

/* ------------------------------------------------------------------ */
/* The allocation-free path                                            */
/* ------------------------------------------------------------------ */

func TestWindowClamping(t *testing.T) {
	tbl := fourRows(t)

	cases := []struct {
		name                 string
		start, count         int32
		wantStart, wantCount int32
	}{
		{"whole table", 0, 4, 0, 4},
		{"middle", 1, 2, 1, 2},
		{"count past the end", 2, 100, 2, 2},
		{"start at the end", 4, 10, 4, 0},
		{"start past the end", 99, 10, 4, 0},
		{"negative start", -5, 2, 0, 2},
		{"negative count", 1, -3, 1, 0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			start, count := tbl.Window(tc.start, tc.count)
			if start != tc.wantStart || count != tc.wantCount {
				t.Fatalf("Window(%d, %d) = %d, %d; want %d, %d",
					tc.start, tc.count, start, count, tc.wantStart, tc.wantCount)
			}
		})
	}
}

func TestViewInto(t *testing.T) {
	tbl := fourRows(t)
	dst := make([]int32, 10)

	n := tbl.ViewInto(1, 2, dst)
	if n != 2 {
		t.Fatalf("ViewInto returned %d, want 2", n)
	}
	if !equalI32(dst[:n], []int32{1, 2}) {
		t.Fatalf("dst = %v, want [1 2]", dst[:n])
	}

	// The same rows View would hand back, without the allocation.
	v := tbl.View(1, 2)
	if !equalI32(dst[:n], v.RowIDs) {
		t.Fatalf("ViewInto gave %v, View gave %v", dst[:n], v.RowIDs)
	}
}

func TestViewIntoStopsAtTheDestinationLength(t *testing.T) {
	tbl := fourRows(t)

	// A short destination truncates rather than overflowing: the ABI sizes
	// its scratch from the clamped window, but a caller that got it wrong
	// should lose rows, not write past the end.
	small := make([]int32, 2)
	if n := tbl.ViewInto(0, 4, small); n != 2 {
		t.Fatalf("ViewInto into a 2-slot buffer returned %d, want 2", n)
	}
	if !equalI32(small, []int32{0, 1}) {
		t.Fatalf("dst = %v, want [0 1]", small)
	}

	if n := tbl.ViewInto(0, 4, nil); n != 0 {
		t.Fatalf("ViewInto into nil returned %d, want 0", n)
	}
}

func TestGather(t *testing.T) {
	tbl := fourRows(t)
	ids := []int32{3, 1}

	i32 := make([]int32, 2)
	if err := tbl.GatherI32(0, ids, i32); err != nil {
		t.Fatalf("GatherI32: %v", err)
	}
	if !equalI32(i32, []int32{40, 20}) {
		t.Fatalf("i32 = %v, want [40 20]", i32)
	}

	f64 := make([]float64, 2)
	if err := tbl.GatherF64(1, ids, f64); err != nil {
		t.Fatalf("GatherF64: %v", err)
	}
	if !equalF64(f64, []float64{4.5, 2.5}) {
		t.Fatalf("f64 = %v, want [4.5 2.5]", f64)
	}

	// A string column yields dictionary ids through the same i32 path,
	// which is what the wire format carries.
	dictIDs := make([]int32, 2)
	if err := tbl.GatherI32(2, ids, dictIDs); err != nil {
		t.Fatalf("GatherI32 on a string column: %v", err)
	}
	dict, _ := tbl.DictSince(2, 0)
	if dict[dictIDs[0]] != "held" || dict[dictIDs[1]] != "shipped" {
		t.Fatalf("ids %v resolve to %q, %q", dictIDs, dict[dictIDs[0]], dict[dictIDs[1]])
	}
}

func TestGatherRejects(t *testing.T) {
	tbl := fourRows(t)
	ids := []int32{0, 1}

	cases := []struct {
		name string
		op   func() error
		want error
	}{
		{"i32 from an f64 column", func() error {
			return tbl.GatherI32(1, ids, make([]int32, 2))
		}, ErrWrongType},
		{"f64 from an i32 column", func() error {
			return tbl.GatherF64(0, ids, make([]float64, 2))
		}, ErrWrongType},
		{"f64 from a string column", func() error {
			return tbl.GatherF64(2, ids, make([]float64, 2))
		}, ErrWrongType},
		{"column past the end", func() error {
			return tbl.GatherI32(9, ids, make([]int32, 2))
		}, ErrNoSuchColumn},
		{"negative column", func() error {
			return tbl.GatherF64(-1, ids, make([]float64, 2))
		}, ErrNoSuchColumn},
		{"destination too short", func() error {
			return tbl.GatherI32(0, ids, make([]int32, 1))
		}, ErrRowCount},
		{"f64 destination too short", func() error {
			return tbl.GatherF64(1, ids, make([]float64, 1))
		}, ErrRowCount},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.op(); !errors.Is(err, tc.want) {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
		})
	}
}

func TestViewIntoAndGatherAllocateNothing(t *testing.T) {
	tbl := fourRows(t)
	ids := make([]int32, 4)
	i32 := make([]int32, 4)
	f64 := make([]float64, 4)

	// The reason this path exists: the ABI runs it on every scroll frame.
	allocs := testing.AllocsPerRun(100, func() {
		tbl.ViewInto(0, 4, ids)
		_ = tbl.GatherI32(0, ids, i32)
		_ = tbl.GatherF64(1, ids, f64)
		_ = tbl.GatherI32(2, ids, i32)
	})
	if allocs != 0 {
		t.Fatalf("allocated %v times per run, want 0", allocs)
	}
}

func TestInternBytesMatchesIntern(t *testing.T) {
	tbl := newTestTable(t, Schema{{Name: "s", Type: String}})

	if _, err := tbl.InsertColumns([]ColumnData{{Strings: []string{"a", "b", "a"}}}); err != nil {
		t.Fatalf("InsertColumns: %v", err)
	}

	// The bytes path has to agree with the string path about which id a
	// value has, or an edit would silently change what a cell means.
	if err := tbl.SetStringBytes(2, 0, []byte("b")); err != nil {
		t.Fatalf("SetStringBytes: %v", err)
	}
	if n, _ := tbl.DictLen(0); n != 2 {
		t.Fatalf("DictLen() = %d, want 2: an existing value must not append", n)
	}

	v := tbl.View(0, 3)
	if !equalI32(v.Cols[0].I32, []int32{0, 1, 1}) {
		t.Fatalf("ids = %v, want [0 1 1]", v.Cols[0].I32)
	}

	// A value the column has never held does append.
	if err := tbl.SetStringBytes(0, 0, []byte("c")); err != nil {
		t.Fatalf("SetStringBytes: %v", err)
	}
	if n, _ := tbl.DictLen(0); n != 3 {
		t.Fatalf("DictLen() = %d, want 3", n)
	}
}

func TestDictionarySurvivesHashCollisions(t *testing.T) {
	d := &dictionary{}
	target := d.add(hashString("target"), "target")
	decoy := d.add(hashString("decoy"), "decoy")

	// Force the decoy into the target's bucket, so a lookup has to walk
	// past a value that hashes the same and is not it. Real collisions are
	// rare enough that they would otherwise never be exercised.
	h := hashString("target")
	d.index[h] = append([]int32{decoy}, d.index[h]...)

	if got := d.internBytes([]byte("target")); got != target {
		t.Errorf("internBytes = %d, want %d: the bucket walk stopped at the decoy", got, target)
	}
	if got := d.intern("target"); got != target {
		t.Errorf("intern = %d, want %d", got, target)
	}
	if d.len() != 2 {
		t.Fatalf("dictionary grew to %d, want 2", d.len())
	}

	// A value that collides but is genuinely new still appends.
	before := d.len()
	fresh := d.internBytes([]byte("brand new"))
	if fresh != before {
		t.Fatalf("new value got id %d, want %d", fresh, before)
	}
}

func TestHashAgreesAcrossStringAndBytes(t *testing.T) {
	for _, v := range []string{"", "a", "status", "caf\xc3\xa9", "a longer value than most"} {
		if hashString(v) != hashBytes([]byte(v)) {
			t.Errorf("hashes disagree for %q", v)
		}
	}
}

func TestStringEqualsBytes(t *testing.T) {
	cases := []struct {
		s    string
		b    string
		want bool
	}{
		{"", "", true},
		{"abc", "abc", true},
		{"abc", "abd", false},
		{"abc", "ab", false},
		{"ab", "abc", false},
		{"caf\xc3\xa9", "caf\xc3\xa9", true},
	}
	for _, tc := range cases {
		if got := stringEqualsBytes(tc.s, []byte(tc.b)); got != tc.want {
			t.Errorf("stringEqualsBytes(%q, %q) = %v, want %v", tc.s, tc.b, got, tc.want)
		}
	}
}

func TestPackedInsertMatchesStringInsert(t *testing.T) {
	values := []string{"new", "shipped", "new", "", "held"}

	blob := []byte("newshippednewheld")
	offsets := []int32{0, 3, 10, 13, 13, 17}

	viaStrings := newTestTable(t, Schema{{Name: "s", Type: String}})
	if _, err := viaStrings.InsertColumns([]ColumnData{{Strings: values}}); err != nil {
		t.Fatalf("InsertColumns: %v", err)
	}

	viaPacked := newTestTable(t, Schema{{Name: "s", Type: String}})
	if _, err := viaPacked.InsertColumns([]ColumnData{{Blob: blob, Offsets: offsets}}); err != nil {
		t.Fatalf("InsertColumns: %v", err)
	}

	a, _ := viaStrings.DictSince(0, 0)
	b, _ := viaPacked.DictSince(0, 0)
	if !equalStrings(a, b) {
		t.Fatalf("dictionaries differ: %v vs %v", a, b)
	}
	if !equalI32(viaStrings.View(0, 5).Cols[0].I32, viaPacked.View(0, 5).Cols[0].I32) {
		t.Fatal("ids differ between the string and packed insert paths")
	}
}

func TestPackedInsertRejectsBadOffsets(t *testing.T) {
	cases := []struct {
		name    string
		blob    []byte
		offsets []int32
	}{
		{"last offset past the blob", []byte("ab"), []int32{0, 99}},
		{"first offset past the blob", []byte("ab"), []int32{99, 99}},
		{"offsets run backwards", []byte("abcd"), []int32{0, 3, 1}},
		{"negative first offset", []byte("ab"), []int32{-1, 2}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tbl := newTestTable(t, Schema{{Name: "s", Type: String}})
			if _, err := tbl.InsertColumns([]ColumnData{
				{Blob: tc.blob, Offsets: tc.offsets},
			}); !errors.Is(err, ErrRowCount) {
				t.Fatalf("InsertColumns = %v, want ErrRowCount", err)
			}
			if tbl.RowCount() != 0 {
				t.Fatal("a rejected insert wrote rows")
			}
		})
	}
}
