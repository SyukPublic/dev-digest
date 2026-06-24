import React from "react";
import { Icon } from "@devdigest/ui";
import type { PrCommit } from "@devdigest/shared";

// Commits are markers, not actions — lighter (dashed, transparent) so they read
// as separators between the runs they sit chronologically between.
const commitRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px dashed var(--border)",
  background: "transparent",
};

/** One commit marker in the PR timeline. */
export function CommitRow({ commit }: { commit: PrCommit }) {
  return (
    <div style={commitRowStyle}>
      <Icon.GitCommit size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      <span className="mono" style={{ fontSize: 12, color: "var(--text-secondary)", flexShrink: 0 }}>
        {commit.sha.slice(0, 7)}
      </span>
      <span
        style={{
          fontSize: 12.5,
          color: "var(--text-secondary)",
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={commit.message}
      >
        {commit.message.split("\n")[0]}
      </span>
      <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{commit.author}</span>
      {commit.committed_at && (
        <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
          {new Date(commit.committed_at).toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}
