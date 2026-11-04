import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { AnchorLink } from "@/components/Anchor";
import { Entry, EntryPoint, Fields, Group, TypeLinks } from "@/components/ApiDocs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ROOT_API as ROOT, typeLinks } from "@/lib/api";

/** Where the old single-page tabs went. */
const OLD_TABS: Record<string, string> = {
  start: "/datagrid/start",
  examples: "/datagrid/examples",
  benchmarks: "/datagrid/benchmarks",
  api: "/datagrid/api",
};

export function CorePage() {
  const { hash } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const to = OLD_TABS[hash.slice(1)];
    if (to) navigate(to, { replace: true });
  }, [hash, navigate]);

  return (
    <TypeLinks.Provider value={typeLinks("core")}>
      <div className="space-y-10">
        <Card id="what-it-is" className="scroll-mt-6">
          <CardHeader>
            <CardTitle className="group/heading flex items-center gap-2 text-base">
              What it is
              <AnchorLink id="what-it-is" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-3 text-sm">
            <p>
              Storing arbitrary JS values in wasm is slower than <code>useState</code>, because
              every read and write has to serialise. Wasm state only pays off when the operations on
              the state also run in wasm. So this is not generic state: each kind of state ships its
              own prebuilt engine and does its work in Go, with only what React needs to render
              crossing back to JS.
            </p>
            <p>
              Two entry points: <code>use-wasm-state</code> holds what every kind of state shares,
              the providers and <code>WasmStateError</code>; <code>use-wasm-state/datagrid</code>{" "}
              holds the grid, its hooks, its engine and its worker.
            </p>
          </CardContent>
        </Card>

        <EntryPoint path="use-wasm-state">
          <Group title="Providers">
            <Entry
              name="WasmStateSyncProvider"
              kind="function"
              signature={ROOT.WasmStateSyncProvider}
            >
              <p>
                Holds shared state on the main thread. Each kind of state gets one engine, loaded
                the first time something uses it and disposed when the provider unmounts. Each
                definition gets one instance, which outlives the components showing it.
              </p>
              <Fields rows={[["urls", "Where each engine is fetched from, by pattern name."]]} />
            </Entry>

            <Separator />

            <Entry
              name="WasmStateAsyncProvider"
              kind="function"
              signature={ROOT.WasmStateAsyncProvider}
            >
              <p>
                The same, with each engine in a worker. Both providers can be nested, and each is
                read only by the hooks of its own mode.
              </p>
              <Fields
                rows={[
                  ["urls", "Where each engine and its worker are fetched from, by pattern name."],
                ]}
              />
            </Entry>

            <Separator />

            <Entry name="useWasmStateSync" kind="hook" signature={ROOT.useWasmStateSync}>
              <p>The sync provider above this component.</p>
            </Entry>

            <Separator />

            <Entry name="useWasmStateAsync" kind="hook" signature={ROOT.useWasmStateAsync}>
              <p>The async provider above this component.</p>
            </Entry>

            <Separator />

            <Entry name="WasmState" kind="type" signature={ROOT.WasmState}>
              <p>
                <code>drop</code> disposes a shared instance. Its next use creates it again from the
                definition, initial rows and all, and anything still showing it gets the new one.
              </p>
            </Entry>

            <Separator />

            <Entry name="WasmStateDef" kind="type" signature={ROOT.WasmStateDef}>
              <p>
                Any shared definition, such as a <code>DataGridDef</code>. Two different definitions
                under one key in one provider are a <code>schema_mismatch</code>, unless they
                describe the same shape.
              </p>
            </Entry>

            <Separator />

            <Entry
              name="WasmStateSyncProviderProps"
              kind="type"
              signature={ROOT.WasmStateSyncProviderProps}
            >
              <p>Read once, when the provider mounts.</p>
            </Entry>

            <Separator />

            <Entry
              name="WasmStateAsyncProviderProps"
              kind="type"
              signature={ROOT.WasmStateAsyncProviderProps}
            >
              <p>Read once, when the provider mounts.</p>
            </Entry>
          </Group>

          <Group title="Errors">
            <Entry name="WasmStateError" kind="class" signature={ROOT.WasmStateError}>
              <p>
                Everything this package throws or reports through a hook's <code>error</code>.
                Engines return small negative integers rather than trapping, and this turns the ones
                you should not ignore into something with a name and a stack.
              </p>
            </Entry>

            <Separator />

            <Entry name="WasmStateErrorCode" kind="type" signature={ROOT.WasmStateErrorCode}>
              <p>Stable names, for switching on a failure.</p>
              <Fields
                rows={[
                  ["schema_mismatch", "Two different definitions share a key in one provider."],
                  ["no_provider", "A definition is used with no provider of its mode above it."],
                  ["disposed", "A call on a grid or engine that has gone."],
                ]}
              />
            </Entry>
          </Group>
        </EntryPoint>
      </div>
    </TypeLinks.Provider>
  );
}
