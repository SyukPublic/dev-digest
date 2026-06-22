import React from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared dialog accessibility behaviour for Modal/Drawer:
 * - Escape closes the dialog.
 * - On open, focus moves into the dialog (first focusable, else the container).
 * - Tab / Shift+Tab are trapped so focus cycles within the dialog.
 * - On unmount, focus is restored to the element that was focused before opening.
 *
 * Attach the returned ref to the dialog container (give it `tabIndex={-1}` so it
 * can hold focus as a fallback). `onClose` is read through a ref, so the focus
 * setup/restore runs once on mount and a changing `onClose` identity (e.g. an
 * inline arrow from the parent) never steals focus mid-interaction.
 */
export function useDialogA11y(onClose?: () => void) {
  const ref = React.useRef<HTMLDivElement>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    const node = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = () =>
      node
        ? Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            (el) => el.offsetParent !== null,
          )
        : [];

    // Move focus into the dialog.
    (focusables()[0] ?? node)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current?.();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, []);

  return ref;
}
