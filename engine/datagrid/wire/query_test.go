package wire

import (
	"errors"
	"github.com/Kezanwar/use-wasm-state/engine/abi"
	"testing"

	"github.com/Kezanwar/use-wasm-state/engine/datagrid"
)

func TestQueryRoundTrip(t *testing.T) {
	cases := []struct {
		name  string
		query datagrid.Query
	}{
		{"empty", datagrid.Query{}},
		{"one sort key", datagrid.Query{Sort: []datagrid.SortKey{{Col: 1, Desc: true}}}},
		{
			"several sort keys",
			datagrid.Query{Sort: []datagrid.SortKey{{Col: 0}, {Col: 2, Desc: true}, {Col: 1}}},
		},
		{
			"numeric filter",
			datagrid.Query{Filters: []datagrid.Filter{{Col: 1, Op: datagrid.OpGt, Number: 12.5}}},
		},
		{
			"between",
			datagrid.Query{Filters: []datagrid.Filter{
				{Col: 1, Op: datagrid.OpBetween, Number: -3.5, Upper: 99},
			}},
		},
		{
			"string filter",
			datagrid.Query{Filters: []datagrid.Filter{{Col: 2, Op: datagrid.OpContains, Text: "ship"}}},
		},
		{
			"in with a list",
			datagrid.Query{Filters: []datagrid.Filter{
				{Col: 2, Op: datagrid.OpIn, List: []string{"new", "paid", ""}},
			}},
		},
		{"search", datagrid.Query{Search: "needle"}},
		{"multi-byte search", datagrid.Query{Search: "caf\xc3\xa9"}},
		{
			"all three",
			datagrid.Query{
				Sort:    []datagrid.SortKey{{Col: 2}, {Col: 1, Desc: true}},
				Filters: []datagrid.Filter{{Col: 1, Op: datagrid.OpGe, Number: 10}},
				Search:  "x",
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := DecodeQuery(EncodeQuery(tc.query))
			if err != nil {
				t.Fatalf("DecodeQuery: %v", err)
			}

			if len(got.Sort) != len(tc.query.Sort) {
				t.Fatalf("got %d sort keys, want %d", len(got.Sort), len(tc.query.Sort))
			}
			for i := range got.Sort {
				if got.Sort[i] != tc.query.Sort[i] {
					t.Errorf("sort %d = %+v, want %+v", i, got.Sort[i], tc.query.Sort[i])
				}
			}

			if len(got.Filters) != len(tc.query.Filters) {
				t.Fatalf("got %d filters, want %d", len(got.Filters), len(tc.query.Filters))
			}
			for i := range got.Filters {
				a, b := got.Filters[i], tc.query.Filters[i]
				if a.Col != b.Col || a.Op != b.Op || a.Number != b.Number ||
					a.Upper != b.Upper || a.Text != b.Text {
					t.Errorf("filter %d = %+v, want %+v", i, a, b)
				}
				if len(a.List) != len(b.List) {
					t.Errorf("filter %d list = %v, want %v", i, a.List, b.List)
					continue
				}
				for j := range a.List {
					if a.List[j] != b.List[j] {
						t.Errorf("filter %d list[%d] = %q, want %q", i, j, a.List[j], b.List[j])
					}
				}
			}

			if got.Search != tc.query.Search {
				t.Errorf("search = %q, want %q", got.Search, tc.query.Search)
			}
		})
	}
}

func TestDecodeQueryLayout(t *testing.T) {
	// Spelled out byte by byte: src/datagrid/abi.ts encodes this format
	// independently, so the bytes themselves are the contract.
	b := []byte{
		1, 0, 0, 0, // u32 sortCount
		2, 0, 0, 0, // i32 col
		1,          // u8 desc
		0, 0, 0, 0, // u32 filterCount
		3, 0, 0, 0, // u32 searchLen
		'a', 'b', 'c',
	}

	q, err := DecodeQuery(b)
	if err != nil {
		t.Fatalf("DecodeQuery: %v", err)
	}
	if len(q.Sort) != 1 || q.Sort[0] != (datagrid.SortKey{Col: 2, Desc: true}) {
		t.Fatalf("sort = %v", q.Sort)
	}
	if q.Search != "abc" {
		t.Fatalf("search = %q", q.Search)
	}
}

func TestDecodeQueryRejects(t *testing.T) {
	good := EncodeQuery(datagrid.Query{
		Sort:    []datagrid.SortKey{{Col: 1}},
		Filters: []datagrid.Filter{{Col: 2, Op: datagrid.OpIn, List: []string{"a"}}},
		Search:  "x",
	})

	cases := []struct {
		name string
		b    []byte
	}{
		{"nil", nil},
		{"shorter than the first count", []byte{0, 0}},
		{"truncated mid sort key", good[:6]},
		{"truncated mid filter", good[:20]},
		{"truncated before the search", good[:len(good)-2]},
		{"sort count larger than the buffer could hold", []byte{255, 255, 255, 255}},
		{
			"filter count larger than the buffer could hold",
			[]byte{0, 0, 0, 0, 255, 255, 255, 255},
		},
		{
			"string length past the end",
			[]byte{0, 0, 0, 0, 0, 0, 0, 0, 200, 0, 0, 0, 'a'},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := DecodeQuery(tc.b); !errors.Is(err, abi.ErrBadArgument) {
				t.Fatalf("DecodeQuery = %v, want abi.ErrBadArgument", err)
			}
		})
	}
}

func TestEmptyQueryIsThreeZeroWords(t *testing.T) {
	b := EncodeQuery(datagrid.Query{})
	if len(b) != 12 {
		t.Fatalf("empty query is %d bytes, want 12", len(b))
	}
	for i, v := range b {
		if v != 0 {
			t.Fatalf("byte %d = %d, want 0", i, v)
		}
	}
}
