import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Webhooks data-access. Owns the `webhook_deliveries` audit table — one row per
 * processed delivery, used by the settings page to show sync activity.
 */

export interface DeliveryRow {
  id: string;
  repoId: string;
  event: string;
  action: string;
  prNumber: number;
  receivedAt: Date;
}

export interface InsertDelivery {
  repoId: string;
  event: string;
  action: string;
  prNumber: number;
}

export class WebhooksRepository {
  constructor(private db: Db) {}

  async recordDelivery(values: InsertDelivery): Promise<DeliveryRow> {
    const [row] = await this.db.insert(t.webhookDeliveries).values(values).returning();
    return row!;
  }

  /** Latest deliveries for a repo, newest first (settings page activity feed). */
  async recentDeliveries(repoId: string, limit: number): Promise<DeliveryRow[]> {
    return this.db
      .select()
      .from(t.webhookDeliveries)
      .where(eq(t.webhookDeliveries.repoId, repoId))
      .orderBy(desc(t.webhookDeliveries.receivedAt))
      .limit(limit);
  }
}
