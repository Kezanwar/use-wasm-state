package abi

import (
	"encoding/binary"
	"math"
	"testing"
	"unsafe"

	"github.com/Kezanwar/use-wasm-state/engine/table"
)

func seededTable(t testing.TB, rows int32) *table.Table {
	t.Helper()
	e := table.NewEngine()
	h, err := e.CreateTable(sampleSchema())
	if err != nil {
		t.Fatalf("CreateTable: %v", err)
	}
	tbl, err := e.Table(h)
	if err != nil {
		t.Fatalf("Table: %v", err)
	}

	labels := []string{"new", "shipped", "held"}
	ids := make([]int32, rows)
	prices := make([]float64, rows)
	statuses := make([]string, rows)
	for i := int32(0); i < rows; i++ {
		ids[i] = i * 10
		prices[i] = float64(i) + 0.5
		statuses[i] = labels[int(i)%len(labels)]
	}
	if _, err := tbl.InsertColumns([]table.ColumnData{
		{I32: ids}, {F64: prices}, {Strings: statuses},
	}); err != nil {
		t.Fatalf("InsertColumns: %v", err)
	}
	return tbl
}

func TestViewOffsets(t *testing.T) {
	s := sampleSchema() // i32, f64, string

	cases := []struct {
		name     string
		n        int32
		wantOffs []int
		wantSize int
	}{
		{
			// 8 header, 3 ids = 12 bytes ending at 20, padded to 24 so the
			// f64 column can be mapped directly.
			"odd row count pads", 3,
			[]int{8, 24, 40, 64}, 76,
		},
		{
			"even row count still pads where needed", 2,
			[]int{8, 16, 24, 40}, 48,
		},
		{"no rows", 0, []int{8, 8, 8, 8}, 8},
		{"one row", 1, []int{8, 16, 24, 32}, 36},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			offs := make([]int, len(s)+1)
			size := ViewOffsets(s, tc.n, offs)

			for i := range tc.wantOffs {
				if offs[i] != tc.wantOffs[i] {
					t.Errorf("section %d at %d, want %d", i, offs[i], tc.wantOffs[i])
				}
			}
			if size != tc.wantSize {
				t.Errorf("size = %d, want %d", size, tc.wantSize)
			}
		})
	}
}

func TestViewOffsetsAreAlwaysAligned(t *testing.T) {
	schemas := []table.Schema{
		sampleSchema(),
		{{Name: "a", Type: table.F64}, {Name: "b", Type: table.F64}},
		{{Name: "a", Type: table.I32}},
		{{Name: "a", Type: table.String}, {Name: "b", Type: table.F64}},
	}

	for _, s := range schemas {
		offs := make([]int, len(s)+1)
		for n := int32(0); n < 40; n++ {
			size := ViewOffsets(s, n, offs)
			for i, off := range offs {
				// JS maps a Float64Array onto these, which throws outright
				// on a misaligned offset.
				if off%8 != 0 {
					t.Fatalf("n=%d section %d at %d is not 8-aligned", n, i, off)
				}
				if off > size {
					t.Fatalf("n=%d section %d at %d is past the end %d", n, i, off, size)
				}
			}
		}
	}
}

// decodeView is the Go mirror of src/engine/abi.ts decodeView, used to read
// back what EncodeView wrote.
func decodeView(t testing.TB, b []byte, s table.Schema) ([]int32, []any) {
	t.Helper()
	n := int32(binary.LittleEndian.Uint32(b))

	offs := make([]int, len(s)+1)
	ViewOffsets(s, n, offs)

	ids := make([]int32, n)
	for i := range ids {
		ids[i] = int32(binary.LittleEndian.Uint32(b[offs[0]+i*4:]))
	}

	cols := make([]any, len(s))
	for c := range s {
		at := offs[c+1]
		if s[c].Type == table.F64 {
			vals := make([]float64, n)
			for i := range vals {
				vals[i] = math.Float64frombits(binary.LittleEndian.Uint64(b[at+i*8:]))
			}
			cols[c] = vals
			continue
		}
		vals := make([]int32, n)
		for i := range vals {
			vals[i] = int32(binary.LittleEndian.Uint32(b[at+i*4:]))
		}
		cols[c] = vals
	}
	return ids, cols
}

func TestEncodeView(t *testing.T) {
	tbl := seededTable(t, 10)

	// wantStart is where the window actually begins after clamping, which
	// is what the header's second word carries.
	cases := []struct {
		name      string
		start     int32
		count     int32
		wantStart uint32
		wantIDs   []int32
	}{
		{"from the start", 0, 3, 0, []int32{0, 1, 2}},
		{"from the middle", 4, 3, 4, []int32{4, 5, 6}},
		{"clamped at the end", 8, 10, 8, []int32{8, 9}},
		{"past the end", 50, 10, 10, nil},
		{"zero count", 0, 0, 0, nil},
		{"negative start", -5, 2, 0, []int32{0, 1}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			b := EncodeView(tbl, tc.start, tc.count)

			n := int32(binary.LittleEndian.Uint32(b))
			if int(n) != len(tc.wantIDs) {
				t.Fatalf("header says %d rows, want %d", n, len(tc.wantIDs))
			}
			if got := binary.LittleEndian.Uint32(b[4:]); got != tc.wantStart {
				t.Errorf("clamped start = %d, want %d", got, tc.wantStart)
			}

			ids, cols := decodeView(t, b, tbl.Schema())
			for i := range tc.wantIDs {
				if ids[i] != tc.wantIDs[i] {
					t.Fatalf("ids = %v, want %v", ids, tc.wantIDs)
				}
				// Column 0 was seeded as rowID*10, column 1 as rowID+0.5.
				if got := cols[0].([]int32)[i]; got != tc.wantIDs[i]*10 {
					t.Errorf("row %d i32 = %d, want %d", i, got, tc.wantIDs[i]*10)
				}
				if got := cols[1].([]float64)[i]; got != float64(tc.wantIDs[i])+0.5 {
					t.Errorf("row %d f64 = %v, want %v", i, got, float64(tc.wantIDs[i])+0.5)
				}
			}
		})
	}
}

func TestEncodeViewStringColumnCarriesDictionaryIDs(t *testing.T) {
	tbl := seededTable(t, 6) // new, shipped, held, new, shipped, held

	_, cols := decodeView(t, EncodeView(tbl, 0, 6), tbl.Schema())
	got := cols[2].([]int32)
	want := []int32{0, 1, 2, 0, 1, 2}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("dictionary ids = %v, want %v", got, want)
		}
	}

	dict, err := tbl.DictSince(2, 0)
	if err != nil {
		t.Fatalf("DictSince: %v", err)
	}
	if dict[got[1]] != "shipped" {
		t.Fatalf("id %d resolves to %q, want %q", got[1], dict[got[1]], "shipped")
	}
}

func TestEncodeViewReusesOneBuffer(t *testing.T) {
	ResetViewBuffer()
	tbl := seededTable(t, 100)

	first := EncodeView(tbl, 0, 50)
	firstPtr := unsafe.Pointer(&first[0])

	second := EncodeView(tbl, 50, 50)
	if unsafe.Pointer(&second[0]) != firstPtr {
		t.Fatal("a second view of the same size reallocated the buffer")
	}
}

func TestEncodeViewBufferGrowsAndNeverShrinks(t *testing.T) {
	ResetViewBuffer()
	tbl := seededTable(t, 500)

	EncodeView(tbl, 0, 10)
	small := ViewCapacity()

	EncodeView(tbl, 0, 400)
	big := ViewCapacity()
	if big <= small {
		t.Fatalf("buffer did not grow: %d then %d", small, big)
	}

	EncodeView(tbl, 0, 10)
	if ViewCapacity() < big {
		t.Fatalf("buffer shrank back to %d from %d", ViewCapacity(), big)
	}
}

func TestEncodeViewBufferIsAligned(t *testing.T) {
	ResetViewBuffer()
	tbl := seededTable(t, 200)

	// Several sizes, because alignment has to survive every regrow, not
	// just the first allocation.
	for _, n := range []int32{1, 3, 7, 16, 33, 150} {
		b := EncodeView(tbl, 0, n)
		if base := uintptr(unsafe.Pointer(&b[0])); base%8 != 0 {
			t.Fatalf("n=%d: buffer starts at %d, which is not 8-aligned", n, base)
		}
	}
}

func TestEncodeViewAfterDeletes(t *testing.T) {
	tbl := seededTable(t, 10)
	if err := tbl.DeleteRows([]int32{0, 1, 2}); err != nil {
		t.Fatalf("DeleteRows: %v", err)
	}

	// start is an offset into the live order, not a row id.
	ids, cols := decodeView(t, EncodeView(tbl, 0, 3), tbl.Schema())
	want := []int32{3, 4, 5}
	for i := range want {
		if ids[i] != want[i] {
			t.Fatalf("ids = %v, want %v", ids, want)
		}
		if got := cols[0].([]int32)[i]; got != want[i]*10 {
			t.Errorf("row %d i32 = %d, want %d", i, got, want[i]*10)
		}
	}
}
