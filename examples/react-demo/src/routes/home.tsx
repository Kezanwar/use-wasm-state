import { HomePage } from "@/pages/HomePage";

export const meta = () => [
  { title: "use-wasm-state" },
  {
    name: "description",
    content:
      "React state for data too big or too busy for useState: the data and the work live in a Go engine compiled to WebAssembly.",
  },
];

export default HomePage;
