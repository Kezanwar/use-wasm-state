import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import * as root from "../src/index";
import * as datagrid from "../src/datagrid/index";
import { DATAGRID_API, DOCUMENTED, ROOT_API, typeLinks } from "../examples/react-demo/src/lib/api";
import { ApiPage } from "../examples/react-demo/src/pages/ApiPage";
import { CorePage } from "../examples/react-demo/src/pages/CorePage";
import { CORE_ANCHORS } from "../examples/react-demo/src/pages/HomePage";

/**
 * The API page against the package, one entry point at a time.
 *
 * A docs page drifts the moment someone adds an export and forgets it.
 * This makes that a failing test rather than a thing a reader notices
 * later. Both directions matter: an undocumented export is a hole, and a
 * documented one that no longer exists is a lie. And each name has to be
 * documented under the entry it actually comes from.
 */

/** Type-only exports vanish at runtime, so they are read from the barrel. */
function typeExports(barrel: string): string[] {
  const source = readFileSync(resolve(process.cwd(), barrel), "utf8");
  const names = new Set<string>();
  for (const block of source.matchAll(/export type \{([^}]*)\}/g)) {
    for (const name of block[1]!.split(",")) {
      const trimmed = name.trim();
      if (trimmed) names.add(trimmed);
    }
  }
  return [...names].sort();
}

const ENTRIES = [
  {
    name: "use-wasm-state",
    module: root,
    barrel: "src/index.ts",
    documented: DOCUMENTED.root,
    api: ROOT_API as Record<string, string>,
  },
  {
    name: "use-wasm-state/datagrid",
    module: datagrid,
    barrel: "src/datagrid/index.ts",
    documented: DOCUMENTED.datagrid,
    api: DATAGRID_API as Record<string, string>,
  },
];

for (const entry of ENTRIES) {
  describe(`the API page: ${entry.name}`, () => {
    const documented = new Set(entry.documented);
    const types = typeExports(entry.barrel);

    it("documents every value it exports", () => {
      const missing = Object.keys(entry.module).filter((name) => !documented.has(name));
      expect(missing, "add these to examples/react-demo/src/lib/api.ts").toEqual([]);
    });

    it("documents every type it exports", () => {
      const missing = types.filter((name) => !documented.has(name));
      expect(missing, "add these to examples/react-demo/src/lib/api.ts").toEqual([]);
    });

    it("documents nothing it does not export", () => {
      const known = new Set([...Object.keys(entry.module), ...types]);
      const extra = entry.documented.filter((name) => !known.has(name));
      expect(extra, "these are on the API page but not exported from here").toEqual([]);
    });

    it("gives every entry a signature naming it", () => {
      for (const [name, signature] of Object.entries(entry.api)) {
        expect(signature.length, name).toBeGreaterThan(10);
        expect(signature, name).toContain(name);
      }
    });
  });
}

describe("the API page", () => {
  it("never documents one name under both entries", () => {
    const both = DOCUMENTED.root.filter((name) => DOCUMENTED.datagrid.includes(name));
    expect(both).toEqual([]);
  });
});

/** Each page as it is pre-rendered, at its own route. */
const render = (path: string, page: ComponentType) =>
  renderToString(createElement(MemoryRouter, { initialEntries: [path] }, createElement(page)));
const PAGES: Record<string, { html: string; names: string[]; api: Record<string, string> }> = {
  "/core": { html: render("/core", CorePage), names: DOCUMENTED.root, api: ROOT_API },
  "/datagrid/api": {
    html: render("/datagrid/api", ApiPage),
    names: DOCUMENTED.datagrid,
    api: DATAGRID_API,
  },
};
const anchors = (html: string) => new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));

/** Platform and React types, which have no page here, and one example binding. */
const NOT_OURS = new Set(
  "ArrayLike Element Error Float64Array HTMLElement Int32Array Iterable JSX Promise ReactNode Readonly Record Required URL Orders".split(
    " "
  )
);

describe("the API pages' anchors and links", () => {
  for (const [path, page] of Object.entries(PAGES)) {
    it(`${path} gives every documented name an anchor`, () => {
      const ids = anchors(page.html);
      expect(page.names.filter((name) => !ids.has(name))).toEqual([]);
    });

    it(`${path} links every type its signatures name`, () => {
      const links = typeLinks(path === "/core" ? "core" : "datagrid");
      const unlinked = Object.entries(page.api).flatMap(([name, signature]) =>
        [...signature.replace(/\/\/.*$/gm, "").matchAll(/\b[A-Z][A-Za-z0-9]+\b/g)]
          .map((m) => m[0])
          .filter((type) => type !== name && !links[type] && !NOT_OURS.has(type))
          .map((type) => `${name}: ${type}`)
      );
      expect(unlinked, "document these, or list them in NOT_OURS").toEqual([]);
    });

    it(`${path} links only to anchors that exist`, () => {
      const hrefs = [...page.html.matchAll(/<pre[\s\S]*?<\/pre>/g)].flatMap((pre) =>
        [...pre[0].matchAll(/href="([^"]+)"/g)].map((m) => m[1]!)
      );
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) {
        const [target, id] = href.split("#");
        expect(PAGES[target!], href).toBeDefined();
        expect(anchors(PAGES[target!]!.html).has(id!), href).toBe(true);
      }
    });
  }
});

describe("links from when Core was the home page", () => {
  it("redirect only to anchors Core still has", () => {
    const ids = anchors(PAGES["/core"]!.html);
    expect([...CORE_ANCHORS].filter((id) => !ids.has(id))).toEqual([]);
  });
});
