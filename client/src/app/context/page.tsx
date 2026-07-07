import { ProjectContextView } from "./_components/ProjectContextView";

/* Route: /context (Project Context Folder). Thin route — the two-pane viewer
   (file list + Preview/Edit) lives in _components. */
export default function ProjectContextPage() {
  return <ProjectContextView />;
}
