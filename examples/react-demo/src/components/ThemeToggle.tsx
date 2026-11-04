import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

type Theme = "light" | "dark";

/**
 * Dark unless the visitor has chosen light here before. The OS preference is
 * deliberately ignored: the palette was designed dark, and root.tsx sets
 * the class by the same rule before first paint.
 */
function initialTheme(): Theme {
  try {
    return localStorage.getItem("theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function ThemeToggle() {
  // Unknown until mounted: the pre-rendered page cannot read storage, so
  // the first client render must draw what the server drew.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => setTheme(initialTheme()), []);

  useEffect(() => {
    if (!theme) return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // Private mode or blocked storage: the toggle still works, it just
      // will not be remembered.
    }
  }, [theme]);

  return (
    <Button
      variant="outline"
      size="icon"
      aria-label="Toggle theme"
      data-testid="theme-toggle"
      onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
    >
      {theme === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </Button>
  );
}
