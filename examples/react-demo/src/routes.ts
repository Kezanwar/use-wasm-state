import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("core", "routes/core.tsx"),
  route("datagrid", "routes/datagrid.tsx", [
    index("routes/datagrid-index.tsx"),
    route("start", "routes/datagrid-start.tsx"),
    route("examples", "routes/datagrid-examples.tsx"),
    route("benchmarks", "routes/datagrid-benchmarks.tsx"),
    route("api", "routes/datagrid-api.tsx"),
  ]),
] satisfies RouteConfig;
