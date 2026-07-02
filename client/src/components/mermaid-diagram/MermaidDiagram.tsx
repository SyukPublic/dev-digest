"use client";

import React from "react";

let seq = 0;

/** Mermaid diagrams must start with a known graph keyword. Anything else
 *  (prose, JSON like {"type":"Buffer"...}, empty) is not a diagram → skip. */
const MERMAID_RE =
  /^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|C4Context)\b/;

function looksLikeMermaid(src: string): boolean {
  return MERMAID_RE.test(src.trim());
}

/**
 * Renders a mermaid diagram string to inline SVG. mermaid is imported lazily
 * (client-only). We VALIDATE with mermaid.parse({suppressErrors}) before
 * rendering — mermaid otherwise injects a "Syntax error" bomb graphic into the
 * DOM on bad input instead of throwing. Junk/unparseable input renders nothing.
 *
 * `maxHeight` caps the scroll viewport (px). The SVG keeps its intrinsic size
 * (Mermaid `flowchart.useMaxWidth:false`) and is read by scrolling both axes,
 * rather than shrinking to fit and becoming illegible. Defaults to 420.
 */
export function MermaidDiagram({ chart, maxHeight = 420 }: { chart: string; maxHeight?: number }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState<"pending" | "ok" | "invalid">("pending");

  React.useEffect(() => {
    let cancelled = false;
    const src = (chart ?? "").trim();
    if (!looksLikeMermaid(src)) {
      setState("invalid");
      return;
    }
    setState("pending");
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        // fontSize is read ONLY from themeVariables (CSS string) in mermaid@11 —
        // the top-level numeric fontSize is never read. useMaxWidth:false makes
        // the renderer emit intrinsic width/height (no max-width style) so the
        // SVG scrolls in the viewport instead of shrinking to fit.
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "strict",
          themeVariables: { fontSize: "13px" },
          flowchart: { useMaxWidth: false },
        });
        // parse first; suppressErrors → returns false (no throw, no DOM bomb).
        const valid = await mermaid.parse(src, { suppressErrors: true });
        if (cancelled) return;
        if (!valid) {
          setState("invalid");
          return;
        }
        const { svg } = await mermaid.render(`dd-mermaid-${seq++}`, src);
        if (cancelled) return;
        if (ref.current) ref.current.innerHTML = svg;
        setState("ok");
      } catch {
        if (!cancelled) setState("invalid");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart]);

  // Not a (valid) diagram → render nothing rather than a broken box.
  if (state === "invalid") return null;

  return (
    <div
      ref={ref}
      style={{
        // Block (not flex + justify-center): a flex viewport with overflow makes
        // the start of an overflowing diagram unreachable by scroll. Block + both-
        // axes auto-overflow lets a large SVG be read by scrolling from top-left,
        // and the box spans the full card (summary) width.
        display: state === "ok" ? "block" : "none",
        width: "100%",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 12,
        maxHeight,
        overflow: "auto",
      }}
    />
  );
}

export default MermaidDiagram;
