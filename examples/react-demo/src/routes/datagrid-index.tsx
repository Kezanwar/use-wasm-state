import { redirect } from "react-router";

/** /datagrid is its first page. */
export const loader = () => redirect("/datagrid/start");

export default function DataGridIndex() {
  return null;
}
