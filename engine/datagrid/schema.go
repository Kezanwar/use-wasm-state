package datagrid

// ColumnType is the storage class of a column. No nulls in v1: every cell
// holds a value of its column's type.
type ColumnType uint8

const (
	// I32 is a 32-bit signed integer, stored as one []int32.
	I32 ColumnType = iota
	// F64 is a 64-bit float, stored as one []float64.
	F64
	// String is dictionary-encoded: cells hold int32 ids into a per-column
	// dictionary, so a column of a million repeated labels costs four bytes
	// a row and the strings cross to JS once each.
	String
)

func (ct ColumnType) String() string {
	switch ct {
	case I32:
		return "i32"
	case F64:
		return "f64"
	case String:
		return "string"
	}
	return "unknown"
}

// Column is one entry in a schema.
type Column struct {
	Name string
	Type ColumnType
}

// Schema is the ordered column list a grid is created from. Order is the
// API: everything addresses columns by index, and Name exists only so a
// caller can look that index up once.
type Schema []Column

// ColumnIndex returns the index of the named column, or false.
//
// A linear scan, not a map: schemas have tens of columns at most, and the
// lookup happens when a component mounts rather than per row. A map here
// would cost an allocation per grid to save nothing measurable.
func (s Schema) ColumnIndex(name string) (int32, bool) {
	for i := range s {
		if s[i].Name == name {
			return int32(i), true
		}
	}
	return 0, false
}

func (s Schema) validate() error {
	if len(s) == 0 {
		return ErrEmptySchema
	}
	for i := range s {
		switch s[i].Type {
		case I32, F64, String:
		default:
			return ErrWrongType
		}
		for j := i + 1; j < len(s); j++ {
			if s[i].Name == s[j].Name {
				return ErrDuplicateColumn
			}
		}
	}
	return nil
}

// clone keeps the grid's schema independent of the caller's slice, which
// is otherwise free to be reused or mutated after CreateGrid returns.
func (s Schema) clone() Schema {
	out := make(Schema, len(s))
	copy(out, s)
	return out
}
