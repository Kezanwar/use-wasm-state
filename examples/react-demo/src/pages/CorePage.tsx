import { Entry, EntryPoint, Fields, Group, TypeLinks } from "@/components/ApiDocs";
import { Separator } from "@/components/ui/separator";
import { ROOT_API as ROOT, typeLinks } from "@/lib/api";

export function CorePage() {
  return (
    <TypeLinks.Provider value={typeLinks("core")}>
      <div className="space-y-10">
        <p className="text-muted-foreground text-sm">
          What every state pattern shares, from <code>use-wasm-state</code>: the providers that hold
          shared state, the error every pattern throws, and their types.
        </p>

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
