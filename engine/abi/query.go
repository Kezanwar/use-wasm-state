package abi

import (
	"encoding/binary"
	"math"

	"github.com/Kezanwar/use-wasm-state/engine/table"
)

// DecodeQuery reads the bytes setQuery is given.
//
// Layout, packed and little-endian. Everything is length-prefixed, nothing
// is NUL-terminated, and the whole query travels in one call because it is
// one thing: a half-applied query would show the wrong rows.
//
//	u32 sortCount
//	  per key:    i32 col, u8 desc
//	u32 filterCount
//	  per filter: i32 col, u8 op, f64 number, f64 upper,
//	              u32 textLen, text bytes,
//	              u32 listCount, per item: u32 len, bytes
//	u32 searchLen, search bytes
//
// An empty query is three zero words, and restores id order.
func DecodeQuery(b []byte) (table.Query, error) {
	r := reader{b: b}
	var q table.Query

	sorts, ok := r.u32()
	if !ok {
		return q, ErrBadArgument
	}
	if sorts > 0 {
		if !r.has(int(sorts) * 5) {
			return q, ErrBadArgument
		}
		q.Sort = make([]table.SortKey, sorts)
		for i := range q.Sort {
			col, _ := r.i32()
			desc, _ := r.u8()
			q.Sort[i] = table.SortKey{Col: col, Desc: desc != 0}
		}
	}

	filters, ok := r.u32()
	if !ok {
		return q, ErrBadArgument
	}
	if filters > 0 {
		// Each filter costs at least 4+1+8+8+4+4 bytes, so a count that
		// could not fit is rejected before it is used as a capacity.
		if !r.has(int(filters) * 29) {
			return q, ErrBadArgument
		}
		q.Filters = make([]table.Filter, filters)
		for i := range q.Filters {
			f := &q.Filters[i]

			col, okCol := r.i32()
			op, okOp := r.u8()
			number, okNumber := r.f64()
			upper, okUpper := r.f64()
			text, okText := r.str()
			if !okCol || !okOp || !okNumber || !okUpper || !okText {
				return q, ErrBadArgument
			}
			f.Col, f.Op, f.Number, f.Upper, f.Text = col, table.Op(op), number, upper, text

			items, okItems := r.u32()
			if !okItems || !r.has(int(items)*4) {
				return q, ErrBadArgument
			}
			if items > 0 {
				f.List = make([]string, items)
				for j := range f.List {
					s, okItem := r.str()
					if !okItem {
						return q, ErrBadArgument
					}
					f.List[j] = s
				}
			}
		}
	}

	search, ok := r.str()
	if !ok {
		return q, ErrBadArgument
	}
	q.Search = search
	return q, nil
}

// EncodeQuery is DecodeQuery's inverse. Only the Go tests use it; JS has
// its own encodeQuery in src/engine/abi.ts, and the two agreeing is what
// test/abi.test.ts checks.
func EncodeQuery(q table.Query) []byte {
	var b []byte
	b = putU32(b, uint32(len(q.Sort)))
	for _, key := range q.Sort {
		b = putU32(b, uint32(key.Col))
		if key.Desc {
			b = append(b, 1)
		} else {
			b = append(b, 0)
		}
	}

	b = putU32(b, uint32(len(q.Filters)))
	for i := range q.Filters {
		f := &q.Filters[i]
		b = putU32(b, uint32(f.Col))
		b = append(b, byte(f.Op))
		b = putU64(b, math.Float64bits(f.Number))
		b = putU64(b, math.Float64bits(f.Upper))
		b = putStr(b, f.Text)
		b = putU32(b, uint32(len(f.List)))
		for _, s := range f.List {
			b = putStr(b, s)
		}
	}

	return putStr(b, q.Search)
}

func putU32(b []byte, v uint32) []byte {
	return append(b, byte(v), byte(v>>8), byte(v>>16), byte(v>>24))
}

func putU64(b []byte, v uint64) []byte {
	return append(b,
		byte(v), byte(v>>8), byte(v>>16), byte(v>>24),
		byte(v>>32), byte(v>>40), byte(v>>48), byte(v>>56))
}

func putStr(b []byte, s string) []byte {
	b = putU32(b, uint32(len(s)))
	return append(b, s...)
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

// reader walks the buffer, reporting rather than panicking when it runs
// out. Every read is checked, because these bytes come from JS.
type reader struct {
	b  []byte
	at int
}

func (r *reader) has(n int) bool { return n >= 0 && r.at+n <= len(r.b) }

func (r *reader) u8() (byte, bool) {
	if !r.has(1) {
		return 0, false
	}
	v := r.b[r.at]
	r.at++
	return v, true
}

func (r *reader) u32() (uint32, bool) {
	if !r.has(4) {
		return 0, false
	}
	v := binary.LittleEndian.Uint32(r.b[r.at:])
	r.at += 4
	return v, true
}

func (r *reader) i32() (int32, bool) {
	v, ok := r.u32()
	return int32(v), ok
}

func (r *reader) f64() (float64, bool) {
	if !r.has(8) {
		return 0, false
	}
	v := math.Float64frombits(binary.LittleEndian.Uint64(r.b[r.at:]))
	r.at += 8
	return v, true
}

func (r *reader) str() (string, bool) {
	n, ok := r.u32()
	if !ok || !r.has(int(n)) {
		return "", false
	}
	s := string(r.b[r.at : r.at+int(n)])
	r.at += int(n)
	return s, true
}
