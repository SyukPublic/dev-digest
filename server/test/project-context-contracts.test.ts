import { describe, it, expect } from 'vitest';
import {
  DiscoveredDocument,
  DocumentContent,
  SpecAttachment,
  FolderType,
  RunTrace,
  PromptAssembly,
} from '@devdigest/shared';

/**
 * Phase 2 contract tests (T6, T7).
 * Pure unit — no DB. Covers the new project-context boundary shapes and the
 * additive, back-compat `spec_tokens` extension of `PromptAssembly`.
 */

// ── T6: DiscoveredDocument / DocumentContent / SpecAttachment ────────────────
describe('project-context contracts (T6)', () => {
  it('DiscoveredDocument parses a valid shape (with + without optionals)', () => {
    const minimal = DiscoveredDocument.parse({
      path: 'specs/foo.md',
      folder_type: 'specs',
      tokens: 42,
    });
    expect(minimal).toEqual({ path: 'specs/foo.md', folder_type: 'specs', tokens: 42 });

    const full = DiscoveredDocument.parse({
      path: 'docs/design/api.md',
      folder_type: 'docs',
      tokens: 0,
      missing: true,
      used_by_agents: 3,
    });
    expect(full.missing).toBe(true);
    expect(full.used_by_agents).toBe(3);
  });

  it('folder_type accepts specs/docs/insights and rejects others', () => {
    for (const ft of ['specs', 'docs', 'insights'] as const) {
      expect(FolderType.parse(ft)).toBe(ft);
    }
    expect(FolderType.safeParse('src').success).toBe(false);
  });

  it('DiscoveredDocument rejects a path containing a ".." traversal segment', () => {
    expect(
      DiscoveredDocument.safeParse({
        path: '../secrets/foo.md',
        folder_type: 'specs',
        tokens: 1,
      }).success,
    ).toBe(false);
    expect(
      DiscoveredDocument.safeParse({
        path: 'specs/../../etc/passwd',
        folder_type: 'specs',
        tokens: 1,
      }).success,
    ).toBe(false);
  });

  it('DiscoveredDocument rejects an empty path and a negative token count', () => {
    expect(
      DiscoveredDocument.safeParse({ path: '', folder_type: 'specs', tokens: 1 }).success,
    ).toBe(false);
    expect(
      DiscoveredDocument.safeParse({ path: 'specs/x.md', folder_type: 'specs', tokens: -1 })
        .success,
    ).toBe(false);
  });

  it('DiscoveredDocument rejects a non-integer token count and an unknown folder_type', () => {
    expect(
      DiscoveredDocument.safeParse({ path: 'specs/x.md', folder_type: 'specs', tokens: 1.5 })
        .success,
    ).toBe(false);
    expect(
      DiscoveredDocument.safeParse({ path: 'specs/x.md', folder_type: 'other', tokens: 1 })
        .success,
    ).toBe(false);
  });

  it('DocumentContent parses raw content + tokens (0 tokens for empty content)', () => {
    const parsed = DocumentContent.parse({
      path: 'insights/note.md',
      content: '',
      tokens: 0,
      folder_type: 'insights',
    });
    expect(parsed.content).toBe('');
    expect(parsed.tokens).toBe(0);
  });

  it('DocumentContent rejects a missing content field and a bad path', () => {
    expect(
      DocumentContent.safeParse({ path: 'docs/x.md', tokens: 1, folder_type: 'docs' }).success,
    ).toBe(false);
    expect(
      DocumentContent.safeParse({
        path: 'docs/../x.md',
        content: 'hi',
        tokens: 1,
        folder_type: 'docs',
      }).success,
    ).toBe(false);
  });

  it('SpecAttachment carries only path + order (never doc text)', () => {
    const att = SpecAttachment.parse({ path: 'specs/a.md', order: 0 });
    expect(att).toEqual({ path: 'specs/a.md', order: 0 });
    // Unknown keys (e.g. a leaked "content") are stripped, not persisted.
    const stripped = SpecAttachment.parse({ path: 'specs/a.md', order: 1, content: 'LEAK' });
    expect(stripped).not.toHaveProperty('content');
  });

  it('SpecAttachment rejects a negative or non-integer order and a traversal path', () => {
    expect(SpecAttachment.safeParse({ path: 'specs/a.md', order: -1 }).success).toBe(false);
    expect(SpecAttachment.safeParse({ path: 'specs/a.md', order: 0.5 }).success).toBe(false);
    expect(SpecAttachment.safeParse({ path: '../a.md', order: 0 }).success).toBe(false);
  });
});

// ── T7: PromptAssembly.spec_tokens (additive, back-compat) ───────────────────
describe('spec_tokens contract (T7)', () => {
  const baseAssembly = {
    system: 'You are a reviewer.',
    user: 'Review this.',
  };

  it('PromptAssembly parses WITH spec_tokens ({path,tokens}[] in order)', () => {
    const parsed = PromptAssembly.parse({
      ...baseAssembly,
      spec_tokens: [
        { path: 'specs/a.md', tokens: 120 },
        { path: 'docs/b.md', tokens: 45 },
      ],
    });
    expect(parsed.spec_tokens).toEqual([
      { path: 'specs/a.md', tokens: 120 },
      { path: 'docs/b.md', tokens: 45 },
    ]);
  });

  it('PromptAssembly parses WITHOUT spec_tokens (older assemblies)', () => {
    const parsed = PromptAssembly.parse({ ...baseAssembly });
    expect(parsed.spec_tokens).toBeUndefined();
  });

  it('an old RunTrace that predates spec_tokens still parses (back-compat)', () => {
    const legacyTrace = {
      config: { agent: 'reviewer', model: 'gpt-4o' },
      stats: {
        duration_ms: 1000,
        tokens_in: 10,
        tokens_out: 20,
        cost_usd: null,
        findings: 0,
        grounding: 'ok',
      },
      // prompt_assembly has NO spec_tokens key at all
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: [],
      log: [],
    };
    const parsed = RunTrace.parse(legacyTrace);
    expect(parsed.prompt_assembly.spec_tokens).toBeUndefined();
  });

  it('a new RunTrace round-trips spec_tokens through parse', () => {
    const trace = {
      config: { agent: 'reviewer', model: 'gpt-4o' },
      stats: {
        duration_ms: 1,
        tokens_in: 1,
        tokens_out: 1,
        cost_usd: 0.01,
        findings: 0,
        grounding: 'ok',
      },
      prompt_assembly: {
        system: 's',
        user: 'u',
        specs: 'attached doc text',
        spec_tokens: [{ path: 'specs/a.md', tokens: 7 }],
      },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: ['specs/a.md'],
      log: [],
    };
    const parsed = RunTrace.parse(trace);
    expect(parsed.prompt_assembly.spec_tokens).toEqual([{ path: 'specs/a.md', tokens: 7 }]);
    expect(parsed.specs_read).toEqual(['specs/a.md']);
  });

  it('spec_tokens rejects a non-integer token count', () => {
    expect(
      PromptAssembly.safeParse({
        ...baseAssembly,
        spec_tokens: [{ path: 'specs/a.md', tokens: 1.2 }],
      }).success,
    ).toBe(false);
  });
});
