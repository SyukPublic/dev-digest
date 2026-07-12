import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Notifications data-access. Owns the `notifications` table. Workspace-scoped
 * throughout — every query filters by `workspace_id`.
 */

export interface NotificationRow {
  id: string;
  workspaceId: string;
  kind: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: Date;
}

export interface InsertNotification {
  workspaceId: string;
  kind: string;
  title: string;
  body: string;
}

export class NotificationsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<NotificationRow[]> {
    return this.db
      .select()
      .from(t.notifications)
      .where(eq(t.notifications.workspaceId, workspaceId))
      .orderBy(desc(t.notifications.createdAt));
  }

  async listUnread(workspaceId: string): Promise<NotificationRow[]> {
    return this.db
      .select()
      .from(t.notifications)
      .where(and(eq(t.notifications.workspaceId, workspaceId), eq(t.notifications.read, false)))
      .orderBy(desc(t.notifications.createdAt))
      .limit(50);
  }

  /** Mark one notification as read. Returns false when it isn't in this workspace. */
  async markRead(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .update(t.notifications)
      .set({ read: true })
      .where(and(eq(t.notifications.workspaceId, workspaceId), eq(t.notifications.id, id)))
      .returning({ id: t.notifications.id });
    return rows.length > 0;
  }

  async insert(values: InsertNotification): Promise<NotificationRow> {
    const [row] = await this.db.insert(t.notifications).values(values).returning();
    return row!;
  }
}
