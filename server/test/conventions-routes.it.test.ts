import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('F2 conventions extractor SSE route (Testcontainers pg)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: '' }),
        llm: { openai: new MockLLMProvider('openai', { structured: {} }) },
      },
    });
  }

  it('SSE: /repos/:id/conventions/extract/:jobId/events replays buffered events and completes', async () => {
    const app = await appWith();
    // Drive the route deterministically (no full extract job): publish events
    // directly onto the run bus under a known jobId, then complete it. RunBus
    // replays its buffer to late subscribers and onDone fires immediately once
    // completed, so the stream ends cleanly.
    const jobId = '11111111-1111-4111-8111-111111111111';
    const repoId = '22222222-2222-4222-8222-222222222222';

    app.container.runBus.publish(jobId, 'info', 'Parsing config files…');
    app.container.runBus.publish(jobId, 'result', 'Extracted 3 conventions');
    app.container.runBus.complete(jobId);

    const sse = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/conventions/extract/${jobId}/events`,
    });
    expect(sse.statusCode).toBe(200);
    expect(sse.headers['content-type']).toContain('text/event-stream');
    expect(sse.payload).toContain('Parsing config files');
    expect(sse.payload).toContain('Extracted 3 conventions');

    await app.close();
  });
});
