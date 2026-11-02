package table

import (
	"errors"
	"testing"
)

func TestSchemaColumnIndex(t *testing.T) {
	s := testSchema()

	cases := []struct {
		name  string
		want  int32
		found bool
	}{
		{"id", 0, true},
		{"price", 1, true},
		{"status", 2, true},
		{"missing", 0, false},
		{"", 0, false},
	}

	for _, tc := range cases {
		got, found := s.ColumnIndex(tc.name)
		if found != tc.found || (found && got != tc.want) {
			t.Errorf("ColumnIndex(%q) = %d, %v; want %d, %v", tc.name, got, found, tc.want, tc.found)
		}
	}
}

func TestSchemaValidate(t *testing.T) {
	cases := []struct {
		name   string
		schema Schema
		want   error
	}{
		{"ok", testSchema(), nil},
		{"single column", Schema{{Name: "n", Type: I32}}, nil},
		{"empty", Schema{}, ErrEmptySchema},
		{"nil", nil, ErrEmptySchema},
		{
			"duplicate name",
			Schema{{Name: "a", Type: I32}, {Name: "a", Type: F64}},
			ErrDuplicateColumn,
		},
		{"unknown type", Schema{{Name: "a", Type: ColumnType(9)}}, ErrWrongType},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.schema.validate(); !errors.Is(err, tc.want) {
				t.Fatalf("validate() = %v, want %v", err, tc.want)
			}
		})
	}
}

func TestSchemaIsCopiedFromTheCaller(t *testing.T) {
	s := testSchema()
	tbl := newTestTable(t, s)

	// Reusing the slice after CreateTable must not rename a live column.
	s[0].Name = "renamed"

	if got := tbl.Schema()[0].Name; got != "id" {
		t.Fatalf("column 0 name = %q, want %q", got, "id")
	}
}

func TestColumnTypeString(t *testing.T) {
	cases := []struct {
		typ  ColumnType
		want string
	}{
		{I32, "i32"},
		{F64, "f64"},
		{String, "string"},
		{ColumnType(9), "unknown"},
	}
	for _, tc := range cases {
		if got := tc.typ.String(); got != tc.want {
			t.Errorf("ColumnType(%d).String() = %q, want %q", tc.typ, got, tc.want)
		}
	}
}
