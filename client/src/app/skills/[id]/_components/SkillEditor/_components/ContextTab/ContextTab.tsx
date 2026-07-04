/* Skill Editor → Context tab. "Project context to use": attach/reorder repo
   markdown docs on this skill; any agent using the skill inherits them. Renders
   a "SERIALIZES AS" path preview under the list. Thin wrapper over the shared
   ContextAttachPanel. */
"use client";

import React from "react";
import type { Skill } from "@devdigest/shared";
import { ContextAttachPanel } from "@/components/context-attach";

export function ContextTab({ skill }: { skill: Skill }) {
  return (
    <ContextAttachPanel
      owner="skills"
      ownerId={skill.id}
      titleKey="skillTab.title"
      badgeKey="skillTab.attachedCount"
      helperKey="skillTab.helper"
      showSerialize
    />
  );
}
