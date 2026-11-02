package table

// Engine holds many tables behind int32 handles.
//
// One engine is one wasm instance and one linear memory, which is why shared
// tables all live in the same one: two engines would mean two copies of every
// row. A one-off hook gets a private engine instead.
//
// Not safe for concurrent use; an engine belongs to the thread that made it.
type Engine struct {
	// tables is indexed by handle and only ever grows. A dropped table
	// leaves a nil behind rather than a free slot, so a handle is never
	// reused and a stale one fails loudly instead of landing on whatever
	// table was created next.
	tables []*Table
}

// NewEngine returns an engine with no tables.
func NewEngine() *Engine { return &Engine{} }

// CreateTable makes a table from an ordered schema and returns its handle.
func (e *Engine) CreateTable(s Schema) (int32, error) {
	if err := s.validate(); err != nil {
		return 0, err
	}
	id := int32(len(e.tables))
	e.tables = append(e.tables, newTable(s))
	return id, nil
}

// Table resolves a handle.
func (e *Engine) Table(id int32) (*Table, error) {
	if id < 0 || id >= int32(len(e.tables)) {
		return nil, ErrNoSuchTable
	}
	t := e.tables[id]
	if t == nil {
		return nil, ErrNoSuchTable
	}
	return t, nil
}

// DropTable releases a table's storage. The handle stays spent for the life
// of the engine.
func (e *Engine) DropTable(id int32) error {
	if _, err := e.Table(id); err != nil {
		return err
	}
	e.tables[id] = nil
	return nil
}

// TableCount is how many tables are live. Handles can exceed it, since
// dropped ones are not reused.
func (e *Engine) TableCount() int32 {
	var n int32
	for _, t := range e.tables {
		if t != nil {
			n++
		}
	}
	return n
}
