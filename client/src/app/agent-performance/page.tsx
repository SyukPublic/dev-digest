import { AgentPerformanceView } from "./_components/AgentPerformanceView";

/* Route: /agent-performance (global Agent Performance dashboard). Thin route
   entry — the view, its summary cards, sortable table, row-expand trends, cost
   donuts, period control and states are colocated under _components. */
export default function AgentPerformancePage() {
  return <AgentPerformanceView />;
}
