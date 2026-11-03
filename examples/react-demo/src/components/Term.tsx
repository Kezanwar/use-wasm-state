import type { ReactNode } from "react";
import { siGo, siWebassembly } from "simple-icons";
import { cn } from "cn";

/**
 * The names that carry colour through the site. Using these rather than
 * typing the words keeps the mapping consistent: violet is always
 * WebAssembly, gold is always JavaScript, cyan is always Go.
 *
 * Pass `icon` to show the brand mark too. Only the header line does;
 * repeating logos through body prose would be noise.
 */

/**
 * A brand mark from simple-icons, whose path data is CC0. Sized in `em` so
 * it tracks the text it sits in, and nudged down to sit on the baseline.
 */
function Mark({ icon, className }: { icon: { path: string }; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("mr-1 inline-block size-[0.95em] shrink-0 align-[-0.1em]", className)}
    >
      <path d={icon.path} fill="currentColor" />
    </svg>
  );
}

export function Wasm({ children = "WebAssembly", icon }: { children?: string; icon?: boolean }) {
  return (
    <span className="text-wasm font-semibold whitespace-nowrap">
      {icon && <Mark icon={siWebassembly} />}
      {children}
    </span>
  );
}

export function Js({ children = "JS" }: { children?: string }) {
  return <span className="text-js font-semibold">{children}</span>;
}

export function Go({ children = "Go", icon }: { children?: string; icon?: boolean }) {
  return (
    <span className="text-go font-semibold whitespace-nowrap">
      {icon && <Mark icon={siGo} />}
      {children}
    </span>
  );
}

/**
 * A product or spec name: Next.js, Vite, ESM, WASI. No colour of its own,
 * but lifted out of the muted body text so it reads as a proper noun
 * rather than prose.
 */
export function Name({ children }: { children: ReactNode }) {
  return <span className="text-foreground">{children}</span>;
}
