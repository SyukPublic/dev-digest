import { describe, it, expect } from 'vitest';
import type { StructuredRequest } from '@devdigest/shared';
import { MockLLMProvider } from '../../server/src/adapters/mocks.js';
import { extractConventions } from '../src/index.js';

/**
 * Engine-level test for extractConventions. Uses the server's mock LLM so we
 * exercise the real prompt assembly + completeStructured path with no network.
 */
describe('extractConventions (engine)', () => {
  const fixture = {
    candidates: [
      {
        rule: 'Always use async/await instead of .then() chains',
        category: 'async',
        evidence_path: 'src/a.ts',
        evidence_snippet: 'const x = await f();',
        confidence: 0.9,
      },
    ],
  };

  it('returns parsed candidates and wraps repo code as untrusted data', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const events: string[] = [];

    const out = await extractConventions({
      llm,
      model: 'deepseek/deepseek-v4-flash',
      repoName: 'acme/api',
      samples: [{ path: 'src/a.ts', content: 'const x = await f();' }],
      onEvent: (e) => events.push(e.msg),
    });

    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0]!.rule).toContain('async/await');

    // The user message must wrap sample files in <untrusted> blocks (injection guard).
    const call = llm.calls.find((c) => c.method === 'completeStructured')!;
    const req = call.req as StructuredRequest<unknown>;
    const system = req.messages[0]!.content;
    const user = req.messages[1]!.content;
    expect(system).toContain('<untrusted>');
    expect(user).toContain('<untrusted source="src/a.ts">');
    expect(events.some((m) => m.includes('candidate'))).toBe(true);
  });
});
