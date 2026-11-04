import { BenchmarksPage } from "@/pages/BenchmarksPage";

export const meta = () => [
  { title: "Benchmarks · DataGrid · use-wasm-state" },
  {
    name: "description",
    content:
      "Load, sort, filter, search and edit 200,000 rows: typical JS, hand-optimised JS and the Go engine, measured and run live.",
  },
];

export default BenchmarksPage;
