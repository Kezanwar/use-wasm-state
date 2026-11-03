import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Who may import whom.
 *
 * The root is what every pattern shares, so it must never reach into one:
 * the day it imports from src/datagrid, a second pattern stops being able
 * to live beside the first without the root changing. And no source file
 * imports the package by name, because every entry is bundled on its own
 * and a self-import would make one depend on another at runtime.
 */

const root = process.cwd();

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const importsOf = (file: string) =>
  [...readFileSync(file, "utf8").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);

const ROOT = [resolve(root, "src/index.ts"), ...sources(resolve(root, "src/core"))];
const ALL = sources(resolve(root, "src"));

describe("boundaries", () => {
  it("keeps the root out of every pattern", () => {
    const leaks = ROOT.flatMap((file) =>
      importsOf(file)
        .filter((spec) => spec.includes("datagrid"))
        .map((spec) => `${relative(root, file)} -> ${spec}`)
    );
    expect(leaks).toEqual([]);
  });

  it("never imports the package by name", () => {
    const self = ALL.flatMap((file) =>
      importsOf(file)
        .filter((spec) => spec === "use-wasm-state" || spec.startsWith("use-wasm-state/"))
        .map((spec) => `${relative(root, file)} -> ${spec}`)
    );
    expect(self).toEqual([]);
  });
});
