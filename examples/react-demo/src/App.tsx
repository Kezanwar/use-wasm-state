import { defineSchema } from "use-wasm-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Placeholder. It exists to prove the wiring: the workspace link resolves,
 * the package's types come through, Tailwind and shadcn are set up.
 *
 * Replaced in build step 6 by the real thing, a 200k-row grid sorting and
 * filtering in Go.
 */
const schema = defineSchema({ id: "i32", price: "f64", status: "string" });

export function App() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <Badge variant="wasm">WebAssembly</Badge>
        <h1 className="text-4xl font-extrabold tracking-tight">use-wasm-state</h1>
        <p className="text-muted-foreground">
          React state that lives in a WebAssembly engine written in Go. Specialised data structures
          whose operations run in wasm; only what React renders crosses to JS.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Scaffold</CardTitle>
          <CardDescription>
            Workspace, tooling and the copied wasm helpers. No engine yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-2 font-mono text-sm">
          <span className="text-muted-foreground">columns</span>
          <span data-testid="package-version" className="tabular text-wasm">
            {schema.names.join(", ")}
          </span>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Next: the Go <code className="font-mono text-foreground">table</code> package, then the ABI,
        then a grid.
      </p>
    </main>
  );
}
