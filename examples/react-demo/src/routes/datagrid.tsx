import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { BookMarked, Gauge, Menu, Puzzle, Rocket } from "lucide-react";
import { cn } from "cn";

const PAGES = [
  { to: "start", label: "Getting started", icon: Rocket },
  { to: "examples", label: "Examples", icon: Puzzle },
  { to: "benchmarks", label: "Benchmarks", icon: Gauge },
  { to: "api", label: "API", icon: BookMarked },
] as const;

/** DataGrid's pages: a sidebar beside them, a menu above them on a phone. */
export default function DataGridLayout() {
  const { pathname } = useLocation();
  const current = PAGES.find((page) => pathname.includes(`/datagrid/${page.to}`)) ?? PAGES[0];
  const [open, setOpen] = useState(false);

  return (
    <div className="gap-8 md:grid md:grid-cols-[11rem_minmax(0,1fr)]">
      <div className="mb-5 md:mb-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="datagrid-nav"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium md:hidden"
        >
          <Menu className="size-4" /> {current.label}
        </button>
        <nav
          id="datagrid-nav"
          aria-label="DataGrid"
          className={cn("mt-1 space-y-0.5 md:sticky md:top-6 md:mt-0 md:block", !open && "hidden")}
        >
          {PAGES.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              data-testid={`nav-${to}`}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                )
              }
            >
              <Icon className="size-4" /> {label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
