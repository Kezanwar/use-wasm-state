#!/usr/bin/env node
/**
 * The README's benchmark block, rendered from benchmarks.json.
 *
 *   node scripts/readme-benchmarks.mjs          rewrite the block
 *   node scripts/readme-benchmarks.mjs --check  fail if it is out of date
 *
 * Nothing is re-measured here. The block is a pure function of the
 * committed figures and the committed module, so a check can run anywhere
 * and a README edited by hand, or a JSON updated without the README,
 * fails it. The module's size is read from the file, never typed.
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";
import { winners } from "../examples/react-demo/src/bench/winners.mjs";

const root = resolve(import.meta.dirname, "..");
const README = resolve(root, "README.md");
const START = "<!-- benchmarks:start -->";
const END = "<!-- benchmarks:end -->";
const IMPLS = [
  ["typical", "Typical JS"],
  ["tuned", "Tuned JS"],
  ["wasm", "Wasm"],
];

export function formatMs(ms) {
  if (ms >= 100) return `${Math.round(ms)} ms`;
  if (ms >= 10) return `${ms.toFixed(1)} ms`;
  if (ms >= 1) return `${ms.toFixed(2)} ms`;
  const us = ms * 1000;
  if (us >= 100) return `${Math.round(us)} µs`;
  if (us >= 10) return `${us.toFixed(1)} µs`;
  if (us >= 1) return `${us.toFixed(2)} µs`;
  return `${Math.round(us * 1000)} ns`;
}

export const formatMB = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

const bold = (cells, wins) => cells.map((text, i) => (wins[i] ? `**${text}**` : text));

/** Reserved linear memory, and the engine's live heap within it. */
export function formatWasmMemory({ wasm, wasmLive }) {
  if (wasm === null) return "";
  return wasmLive == null ? formatMB(wasm) : `${formatMB(wasm)} / ${formatMB(wasmLive)}`;
}

export function renderBlock(figures, wasmBytes) {
  const { machine, runtime } = figures;
  const lines = [
    START,
    "<!-- Generated from benchmarks.json by `pnpm bench`. Edit neither by hand. -->",
    "",
    `Median of ${figures.repeats} runs over ${figures.rows.toLocaleString("en-US")} rows, on ` +
      `${machine.cpu} (${machine.cores} cores, ${machine.memoryGB} GB), ${machine.os}, ` +
      `${runtime.name} ${runtime.version}, ${figures.measured}. Best in bold, with anything within 5% of it.`,
    "",
    `| | ${IMPLS.map(([, label]) => label).join(" | ")} |`,
    `| --- | ${IMPLS.map(() => "---:").join(" | ")} |`,
  ];

  for (const op of figures.operations) {
    const values = IMPLS.map(([id]) => op.results[id].median);
    lines.push(`| ${op.label} | ${bold(values.map(formatMs), winners(values)).join(" | ")} |`);
  }

  const js = IMPLS.map(([id]) => figures.memory[id].js);
  if (js.every((bytes) => bytes !== null)) {
    lines.push(`| JS memory after load | ${bold(js.map(formatMB), winners(js)).join(" | ")} |`);
  }
  lines.push(
    `| Wasm memory after load, reserved / live | ${IMPLS.map(([id]) =>
      formatWasmMemory(figures.memory[id])
    ).join(" | ")} |`
  );

  lines.push(
    "",
    "Typical JS's heap leaves out the strings it shares with the input. " +
      `\`datagrid.wasm\` is ${wasmBytes.toLocaleString("en-US")} bytes. ` +
      "The [Benchmarks tab](https://kezanwar.github.io/use-wasm-state/#benchmarks) runs the same " +
      "benchmark in your browser, and adds what each costs in frames.",
    END
  );
  return lines.join("\n");
}

function current() {
  const figures = JSON.parse(readFileSync(resolve(root, "benchmarks.json"), "utf8"));
  const wasmBytes = statSync(resolve(root, "src/datagrid/datagrid.wasm")).size;
  const readme = readFileSync(README, "utf8");
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start === -1 || end === -1) throw new Error(`README.md has no ${START} … ${END} block`);
  return {
    readme,
    start,
    end: end + END.length,
    expected: renderBlock(figures, wasmBytes),
  };
}

export function writeReadme() {
  const { readme, start, end, expected } = current();
  writeFileSync(README, readme.slice(0, start) + expected + readme.slice(end));
}

export function checkReadme() {
  const { readme, start, end, expected } = current();
  return readme.slice(start, end) === expected;
}

if (fileURLToPath(import.meta.url) === resolve(argv[1] ?? "")) {
  if (argv.includes("--check")) {
    if (!checkReadme()) {
      console.error(
        "README.md's benchmark block does not match benchmarks.json. " +
          "Run `node scripts/readme-benchmarks.mjs` to regenerate it, or `pnpm bench` to re-measure."
      );
      exit(1);
    }
    console.log("README benchmark block is up to date");
  } else {
    writeReadme();
  }
}
