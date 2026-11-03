/**
 * The committed figures, as the site reads them.
 *
 * benchmarks.json is written by `pnpm bench` and nothing else; the README
 * renders from the same file. The site imports it, so a figure on the page
 * is always one that was measured.
 */

import data from "../../../../benchmarks.json";
import type { Results } from "./runner";

export interface Figures extends Results {
  measured: string;
  machine: { cpu: string; cores: number; memoryGB: number; os: string };
  runtime: { name: string; version: string; v8: string };
  package: { version: string; commit: string | null };
}

export const PUBLISHED = data as unknown as Figures;
