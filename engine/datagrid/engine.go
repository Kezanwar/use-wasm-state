package datagrid

// Engine holds many grids behind int32 handles.
//
// One engine is one wasm instance and one linear memory, which is why shared
// grids all live in the same one: two engines would mean two copies of every
// row. A one-off hook gets a private engine instead.
//
// Not safe for concurrent use; an engine belongs to the thread that made it.
type Engine struct {
	// grids is indexed by handle and only ever grows. A dropped grid
	// leaves a nil behind rather than a free slot, so a handle is never
	// reused and a stale one fails loudly instead of landing on whatever
	// grid was created next.
	grids []*Grid
}

// NewEngine returns an engine with no grids.
func NewEngine() *Engine { return &Engine{} }

// CreateGrid makes a grid from an ordered schema and returns its handle.
func (e *Engine) CreateGrid(s Schema) (int32, error) {
	if err := s.validate(); err != nil {
		return 0, err
	}
	id := int32(len(e.grids))
	e.grids = append(e.grids, newGrid(s))
	return id, nil
}

// Grid resolves a handle.
func (e *Engine) Grid(id int32) (*Grid, error) {
	if id < 0 || id >= int32(len(e.grids)) {
		return nil, ErrNoSuchGrid
	}
	t := e.grids[id]
	if t == nil {
		return nil, ErrNoSuchGrid
	}
	return t, nil
}

// DropGrid releases a grid's storage. The handle stays spent for the life
// of the engine.
func (e *Engine) DropGrid(id int32) error {
	if _, err := e.Grid(id); err != nil {
		return err
	}
	e.grids[id] = nil
	return nil
}

// GridCount is how many grids are live. Handles can exceed it, since
// dropped ones are not reused.
func (e *Engine) GridCount() int32 {
	var n int32
	for _, t := range e.grids {
		if t != nil {
			n++
		}
	}
	return n
}
