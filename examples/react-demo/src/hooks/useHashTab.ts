import { useEffect, useState } from "react";

/**
 * The active tab, kept in the URL hash.
 *
 * So every tab can be linked to and the back button does what it looks
 * like it should. The hash is the single source of truth: the state here
 * only mirrors it, and `hashchange` covers both the back button and
 * someone editing the address bar.
 */
export function useHashTab(tabs: readonly string[], fallback: string) {
  const read = () => {
    const hash = globalThis.location?.hash.slice(1) ?? "";
    return tabs.includes(hash) ? hash : fallback;
  };

  const [tab, setTab] = useState(read);

  useEffect(() => {
    const onHashChange = () => setTab(read());
    globalThis.addEventListener("hashchange", onHashChange);
    return () => globalThis.removeEventListener("hashchange", onHashChange);
  });

  const select = (next: string) => {
    setTab(next);
    // replaceState would lose the back button, which is the point of
    // putting this in the URL at all.
    globalThis.location.hash = next;
  };

  return [tab, select] as const;
}
