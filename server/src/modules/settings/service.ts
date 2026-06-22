import type { Container } from '../../platform/container.js';
import type {
  Settings,
  SettingsUpdate,
  SecretsStatus,
  ConnTestRequest,
  ConnTestResult,
} from '@devdigest/shared';
import { SettingsRepository } from './repository.js';
import { rowsToSettings } from './helpers.js';
import { GITHUB_PROVIDER, SECRET_KEY_BY_PROVIDER } from './constants.js';

/**
 * F1 — settings service. Business logic for the Settings feature:
 *   - read/upsert non-secret prefs (through SettingsRepository)
 *   - secrets-status (which provider keys are configured — booleans only)
 *   - test-connection (persist a BYO key, then do a cheap live call)
 *
 * No HTTP and no raw SQL live here; secrets/adapters are reached via the
 * container, prefs persistence through the repository.
 */
export class SettingsService {
  private repo: SettingsRepository;

  constructor(private container: Container) {
    this.repo = new SettingsRepository(container.db);
  }

  async getSettings(workspaceId: string): Promise<Settings> {
    return rowsToSettings(await this.repo.list(workspaceId));
  }

  /** Booleans per provider — true ⇒ a key/PAT is stored. Values never exposed. */
  async secretsStatus(): Promise<SecretsStatus> {
    const entries = await Promise.all(
      (Object.entries(SECRET_KEY_BY_PROVIDER) as [keyof SecretsStatus, string][]).map(
        async ([provider, key]) =>
          [provider, Boolean(await this.container.secrets.get(key))] as const,
      ),
    );
    return Object.fromEntries(entries) as SecretsStatus;
  }

  async updateSettings(
    workspaceId: string,
    userId: string,
    body: SettingsUpdate,
  ): Promise<Settings> {
    const entries = Object.entries(body).map(([key, value]) => ({ key, value }));
    await this.repo.upsert(workspaceId, userId, entries);
    return rowsToSettings(await this.repo.list(workspaceId));
  }

  async testConnection(body: ConnTestRequest): Promise<ConnTestResult> {
    const { provider, key } = body;
    try {
      // If the UI supplied a key, persist it (BYO key) before testing so the
      // test reflects — and the rest of the app can use — the new value.
      if (key) {
        if (!this.container.secrets.set) {
          return { provider, ok: false, message: 'Secrets backend is read-only' };
        }
        await this.container.secrets.set(SECRET_KEY_BY_PROVIDER[provider], key);
        this.container.invalidateSecretCaches();
      }
      if (provider === GITHUB_PROVIDER) {
        const gh = await this.container.github();
        const login = await gh.currentLogin();
        return { provider, ok: true, message: `Connected as @${login}` };
      }
      const llm = await this.container.llm(provider);
      const models = await llm.listModels();
      return { provider, ok: true, message: `OK — ${models.length} models available` };
    } catch (err) {
      return { provider, ok: false, message: (err as Error).message };
    }
  }
}
