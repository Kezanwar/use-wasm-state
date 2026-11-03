package datagrid

import (
	"errors"
	"testing"
)

func TestEngineCreateAndResolve(t *testing.T) {
	e := NewEngine()

	first, err := e.CreateGrid(testSchema())
	if err != nil {
		t.Fatalf("CreateGrid: %v", err)
	}
	second, err := e.CreateGrid(testSchema())
	if err != nil {
		t.Fatalf("CreateGrid: %v", err)
	}

	if first == second {
		t.Fatalf("handles collided: both %d", first)
	}

	a, err := e.Grid(first)
	if err != nil {
		t.Fatalf("Grid(%d): %v", first, err)
	}
	b, err := e.Grid(second)
	if err != nil {
		t.Fatalf("Grid(%d): %v", second, err)
	}
	if a == b {
		t.Fatal("two handles resolved to the same grid")
	}
	if n := e.GridCount(); n != 2 {
		t.Fatalf("GridCount() = %d, want 2", n)
	}
}

func TestEngineRejectsBadSchema(t *testing.T) {
	e := NewEngine()
	if _, err := e.CreateGrid(nil); !errors.Is(err, ErrEmptySchema) {
		t.Fatalf("CreateGrid(nil) = %v, want ErrEmptySchema", err)
	}
	if n := e.GridCount(); n != 0 {
		t.Fatalf("a rejected schema still made a grid: GridCount() = %d", n)
	}
}

func TestEngineHandlesAreNeverReused(t *testing.T) {
	e := NewEngine()

	dropped, err := e.CreateGrid(testSchema())
	if err != nil {
		t.Fatalf("CreateGrid: %v", err)
	}
	if err := e.DropGrid(dropped); err != nil {
		t.Fatalf("DropGrid: %v", err)
	}

	// The next grid must not land on the spent handle: a component holding
	// a stale one would otherwise silently start reading someone else's rows.
	next, err := e.CreateGrid(testSchema())
	if err != nil {
		t.Fatalf("CreateGrid: %v", err)
	}
	if next == dropped {
		t.Fatalf("handle %d was reused after being dropped", next)
	}
	if _, err := e.Grid(dropped); !errors.Is(err, ErrNoSuchGrid) {
		t.Fatalf("Grid(dropped) = %v, want ErrNoSuchGrid", err)
	}
}

func TestEngineBadHandles(t *testing.T) {
	e := NewEngine()
	id, err := e.CreateGrid(testSchema())
	if err != nil {
		t.Fatalf("CreateGrid: %v", err)
	}

	cases := []struct {
		name   string
		handle int32
	}{
		{"negative", -1},
		{"past the end", id + 1},
		{"far past the end", 9999},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := e.Grid(tc.handle); !errors.Is(err, ErrNoSuchGrid) {
				t.Fatalf("Grid(%d) = %v, want ErrNoSuchGrid", tc.handle, err)
			}
			if err := e.DropGrid(tc.handle); !errors.Is(err, ErrNoSuchGrid) {
				t.Fatalf("DropGrid(%d) = %v, want ErrNoSuchGrid", tc.handle, err)
			}
		})
	}
}

func TestEngineDropTwice(t *testing.T) {
	e := NewEngine()
	id, _ := e.CreateGrid(testSchema())

	if err := e.DropGrid(id); err != nil {
		t.Fatalf("first DropGrid: %v", err)
	}
	if err := e.DropGrid(id); !errors.Is(err, ErrNoSuchGrid) {
		t.Fatalf("second DropGrid = %v, want ErrNoSuchGrid", err)
	}
}

func TestEngineGridsAreIndependent(t *testing.T) {
	e := NewEngine()
	aID, _ := e.CreateGrid(testSchema())
	bID, _ := e.CreateGrid(testSchema())
	a, _ := e.Grid(aID)
	b, _ := e.Grid(bID)

	if _, err := a.InsertColumns([]ColumnData{
		{I32: []int32{1}}, {F64: []float64{1}}, {Strings: []string{"x"}},
	}); err != nil {
		t.Fatalf("InsertColumns: %v", err)
	}

	if a.RowCount() != 1 {
		t.Fatalf("a.RowCount() = %d, want 1", a.RowCount())
	}
	if b.RowCount() != 0 {
		t.Fatalf("b.RowCount() = %d, want 0", b.RowCount())
	}
	if b.Revision() != 0 {
		t.Fatalf("b.Revision() = %d, want 0", b.Revision())
	}
}
