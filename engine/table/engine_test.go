package table

import (
	"errors"
	"testing"
)

func TestEngineCreateAndResolve(t *testing.T) {
	e := NewEngine()

	first, err := e.CreateTable(testSchema())
	if err != nil {
		t.Fatalf("CreateTable: %v", err)
	}
	second, err := e.CreateTable(testSchema())
	if err != nil {
		t.Fatalf("CreateTable: %v", err)
	}

	if first == second {
		t.Fatalf("handles collided: both %d", first)
	}

	a, err := e.Table(first)
	if err != nil {
		t.Fatalf("Table(%d): %v", first, err)
	}
	b, err := e.Table(second)
	if err != nil {
		t.Fatalf("Table(%d): %v", second, err)
	}
	if a == b {
		t.Fatal("two handles resolved to the same table")
	}
	if n := e.TableCount(); n != 2 {
		t.Fatalf("TableCount() = %d, want 2", n)
	}
}

func TestEngineRejectsBadSchema(t *testing.T) {
	e := NewEngine()
	if _, err := e.CreateTable(nil); !errors.Is(err, ErrEmptySchema) {
		t.Fatalf("CreateTable(nil) = %v, want ErrEmptySchema", err)
	}
	if n := e.TableCount(); n != 0 {
		t.Fatalf("a rejected schema still made a table: TableCount() = %d", n)
	}
}

func TestEngineHandlesAreNeverReused(t *testing.T) {
	e := NewEngine()

	dropped, err := e.CreateTable(testSchema())
	if err != nil {
		t.Fatalf("CreateTable: %v", err)
	}
	if err := e.DropTable(dropped); err != nil {
		t.Fatalf("DropTable: %v", err)
	}

	// The next table must not land on the spent handle: a component holding
	// a stale one would otherwise silently start reading someone else's rows.
	next, err := e.CreateTable(testSchema())
	if err != nil {
		t.Fatalf("CreateTable: %v", err)
	}
	if next == dropped {
		t.Fatalf("handle %d was reused after being dropped", next)
	}
	if _, err := e.Table(dropped); !errors.Is(err, ErrNoSuchTable) {
		t.Fatalf("Table(dropped) = %v, want ErrNoSuchTable", err)
	}
}

func TestEngineBadHandles(t *testing.T) {
	e := NewEngine()
	id, err := e.CreateTable(testSchema())
	if err != nil {
		t.Fatalf("CreateTable: %v", err)
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
			if _, err := e.Table(tc.handle); !errors.Is(err, ErrNoSuchTable) {
				t.Fatalf("Table(%d) = %v, want ErrNoSuchTable", tc.handle, err)
			}
			if err := e.DropTable(tc.handle); !errors.Is(err, ErrNoSuchTable) {
				t.Fatalf("DropTable(%d) = %v, want ErrNoSuchTable", tc.handle, err)
			}
		})
	}
}

func TestEngineDropTwice(t *testing.T) {
	e := NewEngine()
	id, _ := e.CreateTable(testSchema())

	if err := e.DropTable(id); err != nil {
		t.Fatalf("first DropTable: %v", err)
	}
	if err := e.DropTable(id); !errors.Is(err, ErrNoSuchTable) {
		t.Fatalf("second DropTable = %v, want ErrNoSuchTable", err)
	}
}

func TestEngineTablesAreIndependent(t *testing.T) {
	e := NewEngine()
	aID, _ := e.CreateTable(testSchema())
	bID, _ := e.CreateTable(testSchema())
	a, _ := e.Table(aID)
	b, _ := e.Table(bID)

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
