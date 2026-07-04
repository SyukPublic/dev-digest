import { pgTable, uuid, text, integer, primaryKey } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { agents } from './agents';
import { skills } from './skills';

// ================================================= Project Context attachments
//
// Two ORDERED link tables recording which repository markdown documents are
// attached to a reviewer agent / skill. They mirror `agent_skills` (order +
// cascade on the owner), but a project-context attachment's identity is the
// repo-relative document PATH — never the document text (that is read fresh from
// the read-only clone at run time). Hence the PK is (owner, path), not a FK to a
// documents row: there IS no documents table (docs live in the git clone).
//
// Tenancy: every domain table carries `workspace_id` (FK→workspaces) so the
// base-repository guard can scope every query, and a workspace delete cascades.

/** Markdown docs attached to an AGENT, in injection order. */
export const agentSpecs = pgTable(
  'agent_specs',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Repo-relative path of the attached markdown doc (e.g. `docs/design.md`).
    // Stores the PATH only — never the document text.
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
    createdAt: now(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.agentId, t.path] }) }),
);

/** Markdown docs attached to a SKILL, inherited by agents using that skill. */
export const skillSpecs = pgTable(
  'skill_specs',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Repo-relative path of the attached markdown doc. PATH only — never text.
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
    createdAt: now(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.skillId, t.path] }) }),
);
