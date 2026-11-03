package table

import "errors"

// Sentinels rather than formatted messages: errors.New allocates once at
// startup, where fmt.Errorf would allocate and format on every rejected
// mutation, and fmt in a TinyGo binary costs kilobytes it never earns back.
// Callers compare with errors.Is; the ABI layer maps them to small int codes.
var (
	// ErrNoSuchTable means the handle was never issued, or was dropped.
	ErrNoSuchTable = errors.New("table: no such table")
	// ErrNoSuchColumn means the column index is outside the schema.
	ErrNoSuchColumn = errors.New("table: no such column")
	// ErrNoSuchRow means the row id was never issued.
	ErrNoSuchRow = errors.New("table: no such row")
	// ErrRowDeleted means the row id is valid but tombstoned.
	ErrRowDeleted = errors.New("table: row is deleted")
	// ErrWrongType means the column exists but holds another type.
	ErrWrongType = errors.New("table: wrong column type")
	// ErrColumnCount means the data has a different number of columns than
	// the schema.
	ErrColumnCount = errors.New("table: wrong number of columns")
	// ErrRowCount means the columns in one insert disagree on how many rows
	// they carry. Setting the wrong field of a ColumnData reads as a column
	// of length zero and surfaces here.
	ErrRowCount = errors.New("table: columns have different lengths")
	// ErrEmptySchema means a table was created with no columns. There would
	// be nothing to infer a row count from.
	ErrEmptySchema = errors.New("table: schema has no columns")
	// ErrDuplicateColumn means two columns share a name, which would make
	// ColumnIndex ambiguous.
	ErrDuplicateColumn = errors.New("table: duplicate column name")
	// ErrBadRange means a between filter was given an upper bound below
	// its lower bound, which can only ever match nothing.
	ErrBadRange = errors.New("table: between needs an upper bound at or above the lower")
)
