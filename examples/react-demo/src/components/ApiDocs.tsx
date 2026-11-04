import { createContext, useContext, type ReactNode } from "react";
import { AnchorLink, slug } from "@/components/Anchor";
import { HighlightedCode } from "@/components/CodeBlock";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * The pieces every API page is built from. The public surface is
 * hand-written rather than generated: the useful part of an API page is
 * the sentence saying when to reach for each thing, and a generator cannot
 * write that. The names live in @/lib/api so a test can hold each page
 * against its entry point's own exports.
 */

/** Where each documented name is defined, from the page being shown. See typeLinks. */
export const TypeLinks = createContext<Record<string, string>>({});

export function Entry({
  name,
  kind,
  signature,
  children,
}: {
  name: string;
  kind: "function" | "hook" | "type" | "class";
  signature: string;
  children: ReactNode;
}) {
  return (
    <div id={name} className="scroll-mt-6 space-y-2.5" data-api={name}>
      <div className="group/heading flex flex-wrap items-center gap-2">
        <h3 className="text-foreground font-mono text-sm font-semibold">{name}</h3>
        <AnchorLink id={name} />
        <Badge variant="secondary" className="font-normal">
          {kind}
        </Badge>
      </div>
      <HighlightedCode
        code={signature}
        links={useContext(TypeLinks)}
        self={name}
        className="rounded-md border px-3 py-2 text-[12px] leading-relaxed"
      />
      <div className="text-muted-foreground space-y-2 text-sm">{children}</div>
    </div>
  );
}

export function Fields({ rows }: { rows: [string, string][] }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([name, description]) => (
          <tr key={name} className="border-border/50 border-t align-top">
            <td className="text-foreground w-44 py-1.5 pr-3 font-mono text-xs">{name}</td>
            <td className="text-muted-foreground py-1.5">{description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card id={slug(title)} className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="group/heading flex items-center gap-2 text-base">
          {title}
          <AnchorLink id={slug(title)} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">{children}</CardContent>
    </Card>
  );
}

/** One import path and everything that comes from it. */
export function EntryPoint({ path, children }: { path: string; children: ReactNode }) {
  return (
    <section id={slug(path)} className="scroll-mt-6 space-y-4" data-entry={path}>
      <h2 className="group/heading flex items-center gap-2 font-mono text-sm font-semibold">
        {path}
        <AnchorLink id={slug(path)} />
      </h2>
      {children}
    </section>
  );
}
