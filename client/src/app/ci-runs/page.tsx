import { CiRunsView } from "./_components/CiRunsView";

/* Route: /ci-runs (global CI Runs page). Thin route entry — the view, its
   filters, table rows, refresh/auto-refresh controls, helpers and styles are
   colocated under _components/CiRunsView. */
export default function CiRunsPage() {
  return <CiRunsView />;
}
