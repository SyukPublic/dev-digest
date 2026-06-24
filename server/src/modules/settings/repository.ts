import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SettingsRow } from './helpers.js';

/**
 * F1 — settings data-access. The ONLY place that touches the `settings` table.
 * Feature-local (only the settings module consumes it), so it's constructed by
 * SettingsService rather than promoted to the container. Stores NON-secret prefs
 * as workspace+user+key/value rows; secrets go through SecretsProvider.
 */
export class SettingsRepository {
  constructor(private db: Db) {}

  list(workspaceId: string): Promise<SettingsRow[]> {
    return this.db
      .select({ key: t.settings.key, value: t.settings.value })
      .from(t.settings)
      .where(eq(t.settings.workspaceId, workspaceId));
  }

  async upsert(
    workspaceId: string,
    userId: string,
    entries: { key: string; value: unknown }[],
  ): Promise<void> {
    for (const { key, value } of entries) {
      await this.db
        .insert(t.settings)
        .values({ workspaceId, userId, key, value })
        .onConflictDoUpdate({
          target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
          set: { value },
        });
    }
  }
}
