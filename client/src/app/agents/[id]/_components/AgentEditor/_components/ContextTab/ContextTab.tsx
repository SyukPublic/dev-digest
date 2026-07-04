/* Agent Editor → Context tab. "Project context" section: attach/reorder repo
   markdown docs on this agent. Order defines injection order in the assembled
   `## Project context` block. Thin wrapper over the shared ContextAttachPanel. */
"use client";

import React from "react";
import type { Agent } from "@devdigest/shared";
import { ContextAttachPanel } from "@/components/context-attach";

export function ContextTab({ agent }: { agent: Agent }) {
  return (
    <ContextAttachPanel
      owner="agents"
      ownerId={agent.id}
      titleKey="agentTab.title"
      badgeKey="agentTab.attachedCount"
      helperKey="agentTab.helper"
      showTotalInBadge
    />
  );
}
