// Package wire is the datagrid's wire format: how a schema, a query, an
// insert's column descriptors, a view and a dictionary delta are laid out
// in bytes between engine/datagrid and src/datagrid/abi.ts.
//
// Plain []byte in and out, so it is tested with `go test` like the engine
// it encodes. The two sides agreeing is what test/datagrid/abi.test.ts
// checks against the real datagrid.wasm. StatusOf, which turns the grid's
// errors into the shared status codes, lives here for the same reason: it
// is the datagrid's half of a contract engine/abi only names.
package wire
