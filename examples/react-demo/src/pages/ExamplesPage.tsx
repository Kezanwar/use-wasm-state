import { useState, type ReactNode } from "react";
import { cn } from "cn";
import { CodeTabs, type CodeVariant } from "@/components/CodeBlock";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BasicAsync } from "@/examples/BasicAsync";
import { BasicSync } from "@/examples/BasicSync";
import { GridAsync } from "@/examples/GridAsync";
import { GridSync } from "@/examples/GridSync";
import { SharedAsync } from "@/examples/SharedAsync";
import { SharedSync } from "@/examples/SharedSync";

// ?raw, so the source shown is the source that runs. Editing an example
// updates its listing with no second step to forget.
import basicSyncSource from "@/examples/BasicSync.tsx?raw";
import basicAsyncSource from "@/examples/BasicAsync.tsx?raw";
import gridSyncSource from "@/examples/GridSync.tsx?raw";
import gridAsyncSource from "@/examples/GridAsync.tsx?raw";
import sharedSyncSource from "@/examples/SharedSync.tsx?raw";
import sharedAsyncSource from "@/examples/SharedAsync.tsx?raw";
import basketSource from "@/examples/basket.ts?raw";
import ordersSource from "@/components/Orders.tsx?raw";
import gridSource from "@/components/Grid.tsx?raw";
import virtualSource from "@/hooks/useVirtualWindow.ts?raw";

type Mode = "sync" | "worker";

const basket: CodeVariant = { label: "basket.ts", code: basketSource, language: "ts" };

/** Each example as it runs in either mode, and the files it is made of. */
const EXAMPLES = [
  {
    title: "Basic",
    sync: {
      Example: BasicSync,
      sources: [{ label: "BasicSync.tsx", code: basicSyncSource }, basket],
    },
    worker: {
      Example: BasicAsync,
      sources: [{ label: "BasicAsync.tsx", code: basicAsyncSource }, basket],
    },
  },
  {
    title: "200,000 rows",
    sync: { Example: GridSync, sources: [{ label: "GridSync.tsx", code: gridSyncSource }] },
    worker: { Example: GridAsync, sources: [{ label: "GridAsync.tsx", code: gridAsyncSource }] },
    shared: [
      { label: "Orders.tsx", code: ordersSource },
      { label: "Grid.tsx", code: gridSource },
      { label: "useVirtualWindow.ts", code: virtualSource, language: "ts" },
    ],
  },
  {
    title: "One grid, three components",
    sync: {
      Example: SharedSync,
      sources: [{ label: "SharedSync.tsx", code: sharedSyncSource }, basket],
    },
    worker: {
      Example: SharedAsync,
      sources: [{ label: "SharedAsync.tsx", code: sharedAsyncSource }, basket],
    },
  },
] satisfies {
  title: string;
  sync: { Example: () => ReactNode; sources: CodeVariant[] };
  worker: { Example: () => ReactNode; sources: CodeVariant[] };
  shared?: CodeVariant[];
}[];

export function ExamplesPage() {
  const [mode, setMode] = useState<Mode>("sync");

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <ModeSwitch mode={mode} onMode={setMode} />
      </div>

      {EXAMPLES.map((example) => {
        const { Example, sources } = example[mode];
        return (
          <Card key={example.title}>
            <CardHeader>
              <CardTitle className="text-base">{example.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Keyed on the mode, so a switch is a clean unmount and the
                  engine it replaces is disposed. */}
              <Example key={mode} />
              <CodeTabs variants={[...sources, ...(example.shared ?? [])]} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/** Two words, and the one that is on is the one that is running. */
function ModeSwitch({ mode, onMode }: { mode: Mode; onMode: (mode: Mode) => void }) {
  return (
    <div className="flex items-center rounded-md border p-0.5" role="group" aria-label="Mode">
      {(["sync", "worker"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          data-testid={`mode-${value}`}
          onClick={() => onMode(value)}
          className={cn(
            "rounded px-2.5 py-1 text-xs transition-colors",
            mode === value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {value === "sync" ? "Main thread" : "Worker"}
        </button>
      ))}
    </div>
  );
}
