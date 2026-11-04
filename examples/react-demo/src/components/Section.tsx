import type { ReactNode } from "react";
import { AnchorLink, slug } from "@/components/Anchor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** A titled card with its own anchor, for the prose pages. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card id={slug(title)} className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="group/heading flex items-center gap-2 text-base">
          {title}
          <AnchorLink id={slug(title)} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}
