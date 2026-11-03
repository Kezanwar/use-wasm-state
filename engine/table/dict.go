package table

// dictionary is one string column's value set: an append-only []string plus
// an index for finding what is already there. Cells store the int32 index.
//
// Append-only is the contract, not an implementation detail. JS keeps a
// mirror of values and asks only for what was added since its last known
// length (see Table.DictSince), which works precisely because an id never
// changes meaning. Editing a cell to a new string appends; nothing is ever
// removed, so a column churned through many values grows unboundedly. That
// is a known v1 trade and compaction is a later problem.
type dictionary struct {
	values []string
	// index maps a hash of the value to the ids that hash there. A
	// map[string]int32 would be the obvious thing, but looking one up from
	// UTF-8 bytes means building a Go string first, and a 200k-row insert
	// over six labels would then allocate 200k strings to keep six. Hashing
	// the bytes and comparing against values[id] allocates nothing, so only
	// a genuinely new entry reaches the heap.
	index map[uint64][]int32
}

// sizeHint prepares the index for a column about to receive rows rows.
//
// rows is an upper bound on the number of distinct values and usually a
// wild overestimate, since dictionary encoding is for columns with few of
// them. So it is capped: enough to stop a column of thousands of distinct
// values rehashing its way up from nothing, without reserving 200k buckets
// for a status column with six.
func (d *dictionary) sizeHint(rows int32) {
	if d.index != nil {
		return
	}
	n := int(rows)
	if n > 1024 {
		n = 1024
	}
	d.index = make(map[uint64][]int32, n)
}

// intern returns the id for s, adding it if this is the first time the
// column has seen it.
func (d *dictionary) intern(s string) int32 {
	h := hashString(s)
	for _, id := range d.index[bucket(h)] {
		if d.values[id] == s {
			return id
		}
	}
	return d.add(h, s)
}

// internBytes is intern for a value that is still UTF-8 bytes. It allocates
// only when the value is new.
func (d *dictionary) internBytes(b []byte) int32 {
	h := hashBytes(b)
	for _, id := range d.index[bucket(h)] {
		if stringEqualsBytes(d.values[id], b) {
			return id
		}
	}
	// The one allocation the engine is allowed on this path: a value it has
	// never held has to be copied out of the caller's buffer to outlive it.
	return d.add(h, string(b))
}

func (d *dictionary) add(h uint64, s string) int32 {
	if d.index == nil {
		d.index = make(map[uint64][]int32)
	}
	id := int32(len(d.values))
	d.values = append(d.values, s)
	d.index[bucket(h)] = append(d.index[bucket(h)], id)
	return id
}

func (d *dictionary) len() int32 { return int32(len(d.values)) }

/* ------------------------------------------------------------------ */
/* Hashing                                                             */
/* ------------------------------------------------------------------ */

// FNV-1a, written out twice rather than behind an interface or a generic so
// that neither version can allocate or pay for a dynamic call. Collisions
// are fine: index buckets hold every id that lands there and the comparison
// below settles it.
const (
	fnvOffset uint64 = 14695981039346656037
	fnvPrime  uint64 = 1099511628211
)

// hashMask narrows the bucket space. It is all ones in production, so
// bucket() is an AND the compiler can see through. Tests set it to force
// every value into a handful of buckets, because real FNV-1a collisions
// are too rare to reach the comparison path any other way.
var hashMask = ^uint64(0)

func bucket(h uint64) uint64 { return h & hashMask }

func hashString(s string) uint64 {
	h := fnvOffset
	for i := 0; i < len(s); i++ {
		h = (h ^ uint64(s[i])) * fnvPrime
	}
	return h
}

func hashBytes(b []byte) uint64 {
	h := fnvOffset
	for i := 0; i < len(b); i++ {
		h = (h ^ uint64(b[i])) * fnvPrime
	}
	return h
}

// stringEqualsBytes compares without converting either side. Indexing a
// string yields a byte and allocates nothing; `string(b) == s` would depend
// on a compiler optimisation TinyGo does not make.
func stringEqualsBytes(s string, b []byte) bool {
	if len(s) != len(b) {
		return false
	}
	for i := 0; i < len(b); i++ {
		if s[i] != b[i] {
			return false
		}
	}
	return true
}
