import { MemoryView } from "./_components/MemoryView";

/* Route: /memory (Review Memory studio). Thin route — the three-pane view, its
   rail/cards/detail, the create/edit form, delete confirm, styles, helpers and
   i18n are colocated in _components. */
export default function MemoryPage() {
  return <MemoryView />;
}
