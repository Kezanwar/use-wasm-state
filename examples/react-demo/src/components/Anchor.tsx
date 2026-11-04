import { Link2 } from "lucide-react";

/** A stable anchor id from a heading. */
export const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * A heading's link to itself, shown while the `group/heading` it sits in
 * is hovered. Following it puts the anchor
 * in the address bar; it also copies the full URL.
 */
export function AnchorLink({ id }: { id: string }) {
  return (
    <a
      href={`#${id}`}
      aria-label="Copy link"
      data-anchor={id}
      className="text-muted-foreground hover:text-foreground opacity-0 transition-opacity group-hover/heading:opacity-100 focus-visible:opacity-100"
      onClick={() => {
        void navigator.clipboard?.writeText(new URL(`#${id}`, location.href).href).catch(() => {});
      }}
    >
      <Link2 className="size-3.5" />
    </a>
  );
}
