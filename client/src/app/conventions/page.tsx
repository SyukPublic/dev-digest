import { ConventionsListView } from "./_components/ConventionsListView";

/* Route: /conventions (Conventions Extractor). Thin route — the view, its card,
   the create-skill modal, styles, helpers and i18n are colocated in _components. */
export default function ConventionsPage() {
  return <ConventionsListView />;
}
