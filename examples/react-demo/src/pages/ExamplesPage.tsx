import type { ReactNode } from "react";
import { CodeTabs } from "@/components/CodeBlock";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BasicExample } from "@/examples/BasicExample";
import { GridExample } from "@/examples/GridExample";
import { TwoViewsExample } from "@/examples/TwoViewsExample";

// ?raw, so the source shown is the source that runs. Editing an example
// updates its listing with no second step to forget.
import basicSource from "@/examples/BasicExample.tsx?raw";
import gridExampleSource from "@/examples/GridExample.tsx?raw";
import gridSource from "@/components/Grid.tsx?raw";
import virtualSource from "@/hooks/useVirtualWindow.ts?raw";
import twoViewsSource from "@/examples/TwoViewsExample.tsx?raw";

function Example({
  title,
  children,
  sources,
}: {
  title: string;
  children: ReactNode;
  sources: { label: string; code: string; language?: string }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {children}
        <CodeTabs variants={sources} />
      </CardContent>
    </Card>
  );
}

export function ExamplesPage() {
  return (
    <div className="space-y-6">
      <Example title="Basic" sources={[{ label: "BasicExample.tsx", code: basicSource }]}>
        <BasicExample />
      </Example>

      <Example
        title="200,000 rows"
        sources={[
          { label: "GridExample.tsx", code: gridExampleSource },
          { label: "Grid.tsx", code: gridSource },
          { label: "useVirtualWindow.ts", code: virtualSource, language: "ts" },
        ]}
      >
        <GridExample />
      </Example>

      <Example
        title="Two views, one table"
        sources={[{ label: "TwoViewsExample.tsx", code: twoViewsSource }]}
      >
        <TwoViewsExample />
      </Example>
    </div>
  );
}
