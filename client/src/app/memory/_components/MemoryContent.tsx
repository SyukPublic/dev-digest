/* MemoryContent — renders memory content as ESCAPED text, with backtick-
   delimited spans shown as inline <code>. Never uses dangerouslySetInnerHTML,
   so code/markup in content can never execute (AC-24, A05 stored-XSS). */
"use client";

import React from "react";
import { splitInlineCode } from "./helpers";

export function MemoryContent({ content, style }: { content: string; style?: React.CSSProperties }) {
  const segments = splitInlineCode(content);
  return (
    <span style={style}>
      {segments.map((seg, i) =>
        seg.code ? (
          <code
            key={i}
            className="mono"
            style={{
              background: "var(--bg-hover)",
              borderRadius: 4,
              padding: "1px 5px",
              fontSize: "0.9em",
              color: "var(--accent-text)",
            }}
          >
            {seg.text}
          </code>
        ) : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        ),
      )}
    </span>
  );
}
