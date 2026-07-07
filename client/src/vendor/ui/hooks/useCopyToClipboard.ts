/* useCopyToClipboard — de-dups the inline "write to clipboard + flash a
   `copied` flag that resets after a delay" pattern into one hook. Used by the
   run-trace copy buttons, command rows, and the Share link. */
import React from "react";

export interface UseCopyToClipboard {
  /** True for `resetMs` after a successful `copy` call, then flips back. */
  copied: boolean;
  /** Write `text` to the clipboard and flash `copied`. */
  copy: (text: string) => void;
}

/**
 * Copy-to-clipboard with a self-resetting `copied` flag.
 *
 * @param resetMs how long `copied` stays true before resetting (default 1500ms).
 */
export function useCopyToClipboard(resetMs = 1500): UseCopyToClipboard {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = React.useCallback(
    (text: string) => {
      void navigator.clipboard?.writeText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), resetMs);
    },
    [resetMs],
  );

  // Clear a pending reset on unmount so we never set state on a gone component.
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { copied, copy };
}
