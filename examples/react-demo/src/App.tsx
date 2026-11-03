import { BookMarked, CodeXml, Gauge, Puzzle, Rocket } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CopyForLlm } from "@/components/CopyForLlm";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Go, Wasm } from "@/components/Term";
import { ApiPage } from "@/pages/ApiPage";
import { BenchmarksPage } from "@/pages/BenchmarksPage";
import { ExamplesPage } from "@/pages/ExamplesPage";
import { GettingStartedPage } from "@/pages/GettingStartedPage";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useHashTab } from "@/hooks/useHashTab";

const TABS = ["start", "examples", "benchmarks", "api"] as const;

export function App() {
  const [tab, setTab] = useHashTab(TABS, "start");

  return (
    <TooltipProvider>
      <div className="min-h-dvh px-4 py-10">
        <main className="mx-auto max-w-5xl space-y-6">
          <header className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight">
                use-wasm-<span className="text-wasm">state</span>
              </h1>
              <p className="text-muted-foreground mt-1 text-sm">
                React state that lives in a <Wasm icon /> engine written in <Go icon />.
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <CopyForLlm />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Copy a brief about this package, written for an LLM. Paste it into a chat before
                  asking for code.
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" asChild aria-label="Source on GitHub">
                    <a
                      href="https://github.com/Kezanwar/use-wasm-state"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <CodeXml className="size-4" />
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Source on GitHub</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <ThemeToggle />
                  </span>
                </TooltipTrigger>
                <TooltipContent>Switch between dark and light</TooltipContent>
              </Tooltip>
            </div>
          </header>

          <Tabs value={tab} onValueChange={setTab}>
            {/*
              Wraps rather than overflowing, for a phone. The variant class
              has to be overridden by name: the component pins the height
              through a group-data selector that a plain h-auto does not
              replace.
            */}
            <TabsList className="h-auto flex-wrap group-data-[orientation=horizontal]/tabs:h-auto">
              <TabsTrigger value="start" data-testid="tab-start">
                <Rocket className="size-4" /> Getting started
              </TabsTrigger>
              <TabsTrigger value="examples" data-testid="tab-examples">
                <Puzzle className="size-4" /> Examples
              </TabsTrigger>
              <TabsTrigger value="benchmarks" data-testid="tab-benchmarks">
                <Gauge className="size-4" /> Benchmarks
              </TabsTrigger>
              <TabsTrigger value="api" data-testid="tab-api">
                <BookMarked className="size-4" /> API
              </TabsTrigger>
            </TabsList>

            <TabsContent value="start" className="mt-5">
              <GettingStartedPage />
            </TabsContent>

            <TabsContent value="examples" className="mt-5">
              <ExamplesPage />
            </TabsContent>

            <TabsContent value="benchmarks" className="mt-5">
              <BenchmarksPage />
            </TabsContent>

            <TabsContent value="api" className="mt-5">
              <ApiPage />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </TooltipProvider>
  );
}
