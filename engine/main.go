// Command engine is the wasm module shipped with use-wasm-state.
//
// It is the ABI layer and nothing else: //go:wasmexport wrappers that turn
// pointers and lengths into Go values, hand them to ./table, and pack the
// results back out. No logic lives here, so the engine stays testable as
// plain Go (see ./table) and this file stays reviewable as a contract.
//
// Built with TinyGo for -target=wasm-unknown, which has no WASI runtime:
// the module must import nothing at all. scripts/inspect-wasm.mjs enforces
// that after every build.
package main

// Imported for its side effect on the build, not for anything it is used
// for yet: it puts ./table in the TinyGo compile graph, so a construct
// TinyGo cannot handle fails here rather than in build step 4. Nothing
// references it, so the linker strips it from the module.
import _ "github.com/Kezanwar/use-wasm-state/engine/table"

// TinyGo needs a main for a `package main`, but wasm-unknown never calls it.
// The module is a reactor: the host runs the _initialize TinyGo adds, then
// calls exports. Nothing is exported yet; the ABI arrives in build step 4.
func main() {}
