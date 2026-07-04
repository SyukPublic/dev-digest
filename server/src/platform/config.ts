import 'dotenv/config';
import { z } from 'zod';
import { homedir } from 'node:os';
import { join, isAbsolute, resolve } from 'node:path';

/**
 * Central, zod-validated environment config. Loaded once at startup.
 *
 * NOTE: secret keys (OPENAI/ANTHROPIC/OPENROUTER/GITHUB_TOKEN) are deliberately
 * NOT in this schema. Feature code must access secrets through SecretsProvider,
 * never via process.env or AppConfig — the SecretsProvider is the one chokepoint
 * that reads process.env directly (see adapters/secrets/local.ts). Listing them
 * here would be dead config that never reaches AppConfig.
 */
const EnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .default('postgres://devdigest:devdigest@localhost:5432/devdigest'),
  // Memory/RAG embeddings run on OpenAI (text-embedding-3-small, 1536-dim — the
  // pgvector columns are locked to that). Default OFF so the app makes ZERO
  // OpenAI requests; set EMBEDDINGS_ENABLED=true to turn memory retrieval on.
  EMBEDDINGS_ENABLED: z.string().optional(),
  // repo-intel facade (Tier 1). Default ON — reviews get repo skeleton +
  // callers context. Set REPO_INTEL_ENABLED=false to opt out, in which case
  // every consumer degrades to ripgrep-identical behavior (acceptance #10).
  // Note: even when on, sections only populate once the repo is indexed; an
  // unindexed repo degrades gracefully. Per-agent override: agents.repo_intel.
  REPO_INTEL_ENABLED: z.string().optional(),
  // Project Context Folder (producer side). Two DISTINCT thresholds:
  //   - PROJECT_CONTEXT_TOKEN_BUDGET: SOFT total-token budget (UI warn-only,
  //     never blocks attaching, never truncates — spec AC-14).
  //   - PROJECT_CONTEXT_FILE_HARD_CAP_BYTES: per-file HARD cap; a single file
  //     over this is skipped-with-warning at run time (never truncated — AC-13)
  //     and excluded from discovery.
  // PROJECT_CONTEXT_ROOTS: comma-separated top-level folder names discovery
  //   globs `*.md` under (default `specs,docs,insights`).
  PROJECT_CONTEXT_TOKEN_BUDGET: z.coerce.number().int().default(20_000),
  PROJECT_CONTEXT_FILE_HARD_CAP_BYTES: z.coerce.number().int().default(256 * 1024),
  PROJECT_CONTEXT_ROOTS: z.string().optional(),
  API_PORT: z.coerce.number().int().default(3001),
  WEB_PORT: z.coerce.number().int().default(3000),
  DEVDIGEST_CLONE_DIR: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // `.env` (and .env.example) ship `LOG_LEVEL=` empty; an empty string is not a
  // valid enum member, so coerce '' → undefined to fall through to the default.
  LOG_LEVEL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  ),
});

export type AppConfig = {
  databaseUrl: string;
  apiPort: number;
  webPort: number;
  /** Absolute path where repos are cloned (~/.devdigest/workspace by default). */
  cloneDir: string;
  /** Absolute path to the writable secrets store (BYO keys from the UI). */
  secretsPath: string;
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: string;
  /** Allowed CORS origin for the Next.js dev server. */
  webOrigin: string;
  /** Whether memory/RAG embeddings (OpenAI) are enabled. Default false. */
  embeddingsEnabled: boolean;
  /**
   * Whether the repo-intel facade (Tier 1: phantom-gate, callers-in-prompt) is
   * active. Default ON — set REPO_INTEL_ENABLED=false to opt out, in which case
   * every facade method returns its degraded result (`[]`) so consumers behave
   * EXACTLY like the ripgrep-only baseline.
   */
  repoIntelEnabled: boolean;
  /** SOFT total-token budget for attached project-context docs (UI warn-only). */
  projectContextTokenBudget: number;
  /** Per-file HARD cap (bytes); a doc over this is skipped, never truncated. */
  projectContextFileHardCapBytes: number;
  /** Top-level folder names discovery globs `*.md` under (default specs/docs/insights). */
  projectContextRoots: string[];
};

/** Parse `PROJECT_CONTEXT_ROOTS` (comma list) → trimmed, de-duped folder names. */
function parseRoots(raw: string | undefined): string[] {
  const fallback = ['specs', 'docs', 'insights'];
  if (raw === undefined) return fallback;
  const parsed = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
  return parsed.length > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  const cloneDirRaw =
    parsed.DEVDIGEST_CLONE_DIR ?? join(homedir(), '.devdigest', 'workspace');
  const cloneDir = isAbsolute(cloneDirRaw) ? cloneDirRaw : resolve(process.cwd(), cloneDirRaw);
  return {
    databaseUrl: parsed.DATABASE_URL,
    apiPort: parsed.API_PORT,
    webPort: parsed.WEB_PORT,
    cloneDir,
    secretsPath: join(homedir(), '.devdigest', 'secrets.json'),
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL ?? (parsed.NODE_ENV === 'test' ? 'silent' : 'info'),
    webOrigin: `http://localhost:${parsed.WEB_PORT}`,
    embeddingsEnabled: parsed.EMBEDDINGS_ENABLED === 'true',
    repoIntelEnabled: parsed.REPO_INTEL_ENABLED !== 'false',
    projectContextTokenBudget: parsed.PROJECT_CONTEXT_TOKEN_BUDGET,
    projectContextFileHardCapBytes: parsed.PROJECT_CONTEXT_FILE_HARD_CAP_BYTES,
    projectContextRoots: parseRoots(parsed.PROJECT_CONTEXT_ROOTS),
  };
}
