package table

// dictionary is one string column's value set: an append-only []string plus
// a reverse lookup. Cells store the int32 index.
//
// Append-only is the contract, not an implementation detail. JS keeps a
// mirror of this slice and asks only for what was added since its last known
// length (see Table.DictSince), which works precisely because an id never
// changes meaning. Editing a cell to a new string appends; nothing is ever
// removed, so a column churned through many values grows unboundedly. That
// is a known v1 trade and compaction is a later problem.
type dictionary struct {
	values []string
	ids    map[string]int32
}

// intern returns the id for s, adding it if this is the first time the
// column has seen it.
func (d *dictionary) intern(s string) int32 {
	if id, ok := d.ids[s]; ok {
		return id
	}
	if d.ids == nil {
		d.ids = make(map[string]int32)
	}
	id := int32(len(d.values))
	d.values = append(d.values, s)
	d.ids[s] = id
	return id
}

func (d *dictionary) len() int32 { return int32(len(d.values)) }
