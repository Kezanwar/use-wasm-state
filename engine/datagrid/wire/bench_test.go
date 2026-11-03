package wire

import "testing"

// BenchmarkEncodeView is the whole Go half of a scroll frame: clamp the
// window, gather three columns and write the wire format. It has to stay
// allocation-free after the first call, which is what ReportAllocs is here
// to prove.
func BenchmarkEncodeView(b *testing.B) {
	tbl := seededGrid(b, 200_000)
	EncodeView(tbl, 0, 50) // warm the buffer, so the loop measures steady state

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		out := EncodeView(tbl, int32(i%199_000), 50)
		if len(out) == 0 {
			b.Fatal("empty view")
		}
	}
}

func BenchmarkEncodeDict(b *testing.B) {
	values := []string{"new", "paid", "picked", "shipped", "held", "cancelled"}
	dst := make([]byte, DictSize(values))

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		EncodeDict(values, dst)
	}
}
