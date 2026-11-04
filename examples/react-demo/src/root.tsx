import type { ReactNode } from "react";
import {
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";
import { CodeXml } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CopyForLlm } from "@/components/CopyForLlm";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Go, Wasm } from "@/components/Term";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import styles from "./styles.css?url";

/** One tab per state pattern. A new pattern adds a line here and its routes. */
const PATTERNS = [
  { to: "/", label: "Core", id: "core" },
  { to: "/datagrid", label: "DataGrid", id: "datagrid" },
] as const;

// Dark by default. The OS preference is deliberately not consulted. Inline
// and in <head> so the first paint, pre-rendered or not, is already right.
const THEME = `try {
  if (localStorage.getItem("theme") !== "light") document.documentElement.classList.add("dark");
} catch {
  document.documentElement.classList.add("dark");
}`;

export const links = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" as const },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap",
  },
  { rel: "stylesheet", href: styles },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    // The theme script sets the class before React does, so React is told
    // the attribute may differ.
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <Meta />
        <Links />
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { pathname } = useLocation();
  const pattern = PATTERNS.find((p) => p.to !== "/" && pathname.startsWith(p.to))?.id ?? "core";

  return (
    <TooltipProvider>
      <div className="min-h-dvh px-4 py-10">
        <main className="mx-auto max-w-6xl space-y-6">
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

          <Tabs value={pattern}>
            <TabsList>
              {PATTERNS.map(({ to, label, id }) => (
                <TabsTrigger key={id} value={id} asChild>
                  <NavLink to={to} data-testid={`tab-${id}`}>
                    {label}
                  </NavLink>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <Outlet />
        </main>
      </div>
    </TooltipProvider>
  );
}
