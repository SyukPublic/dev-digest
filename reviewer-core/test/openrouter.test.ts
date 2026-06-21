import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { OpenRouterProvider } from '../src/llm/openrouter.js';

/**
 * Unit tests for OpenRouterProvider.completeStructured. The provider forces the
 * SDK onto Node's global undici fetch (the default node-fetch shim throws
 * "Premature close" reading some OpenRouter responses). These tests fake the
 * OpenAI client so there is no network — they exercise the structured-output
 * assembly: parse, usage/cost, the reprompt loop, and the no-choices guard.
 */

const schema = z.object({
  summary: z.string(),
  findings: z.array(z.object({ title: z.string() })),
});

/** Inject a fake `client.chat.completions.create` into a provider instance. */
function withClient(provider: OpenRouterProvider, create: (params: unknown) => Promise<unknown>) {
  (provider as unknown as { client: { chat: { completions: { create: typeof create } } } }).client = {
    chat: { completions: { create } },
  };
}

const req = {
  model: 'deepseek/deepseek-v4-flash',
  schema,
  schemaName: 'Review',
  messages: [{ role: 'user' as const, content: 'review this' }],
};

const completion = (content: string, usage?: Record<string, number>) => ({
  choices: [{ message: { content } }],
  ...(usage ? { usage } : {}),
});

describe('OpenRouterProvider.completeStructured', () => {
  it('parses the JSON content and reads usage/cost (OpenRouter `usage.cost` extension)', async () => {
    const provider = new OpenRouterProvider('test-key');
    withClient(provider, async () =>
      completion('{"summary":"ok","findings":[]}', {
        prompt_tokens: 12,
        completion_tokens: 8,
        cost: 0.0003,
      }),
    );

    const res = await provider.completeStructured(req);
    expect(res.data.summary).toBe('ok');
    expect(res.tokensIn).toBe(12);
    expect(res.tokensOut).toBe(8);
    expect(res.costUsd).toBe(0.0003);
    expect(res.attempts).toBe(1);
  });

  it('reprompts on invalid JSON, then succeeds (attempts increments)', async () => {
    const provider = new OpenRouterProvider('test-key');
    let calls = 0;
    withClient(provider, async () => {
      calls++;
      return calls === 1
        ? completion('not json at all')
        : completion('{"summary":"recovered","findings":[]}', { prompt_tokens: 1, completion_tokens: 1 });
    });

    const res = await provider.completeStructured(req);
    expect(calls).toBe(2);
    expect(res.data.summary).toBe('recovered');
    expect(res.attempts).toBe(2);
  });

  it('throws on a 200-with-no-choices error payload', async () => {
    const provider = new OpenRouterProvider('test-key');
    withClient(provider, async () => ({ choices: [], error: { message: 'upstream exploded' } }));

    await expect(provider.completeStructured(req)).rejects.toThrow('upstream exploded');
  });
});
