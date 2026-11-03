import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

type Theme = "light" | "dark";

/**
 * Dark unless the visitor has chosen light here before. The OS preference is
 * deliberately ignored: the palette was designed dark, and index.html sets
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
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
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
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
