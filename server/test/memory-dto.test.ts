import { describe, it, expect } from 'vitest';
import { CreateMemory, UpdateMemory, MemoryListQuery } from '@devdigest/shared';

/**
 * test_dto_validation (AC-1/AC-2/AC-7) — the Memory boundary shapes accept valid
 * input and reject the AC-7 violations (missing content, confidence out of 0..1,
 * repo scope without a repo). MemoryListQuery coerces the raw query string.
 */
describe('Memory contracts', () => {
  describe('CreateMemory', () => {
    it('accepts a valid global entry and defaults sources to []', () => {
      const r = CreateMemory.safeParse({
        content: 'DB migrations ship in their own PR.',
        scope: 'global',
        kind: 'convention',
        confidence: 0.9,
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.sources).toEqual([]);
    });

    it('accepts a repo entry only with a repo_id', () => {
      const ok = CreateMemory.safeParse({
        content: 'x',
        scope: 'repo',
        kind: 'fact',
        confidence: 1,
        repo_id: '11111111-1111-4111-8111-111111111111',
      });
      expect(ok.success).toBe(true);
    });

    it('rejects repo scope without repo_id (AC-7)', () => {
      const r = CreateMemory.safeParse({ content: 'x', scope: 'repo', kind: 'fact', confidence: 1 });
      expect(r.success).toBe(false);
    });

    it('rejects non-repo scope carrying a repo_id (AC-7)', () => {
      const r = CreateMemory.safeParse({
        content: 'x',
        scope: 'global',
        kind: 'fact',
        confidence: 1,
        repo_id: '11111111-1111-4111-8111-111111111111',
      });
      expect(r.success).toBe(false);
    });

    it('rejects empty content and out-of-range confidence (AC-7)', () => {
      expect(CreateMemory.safeParse({ content: '', scope: 'global', kind: 'fact', confidence: 0.5 }).success).toBe(false);
      expect(CreateMemory.safeParse({ content: 'x', scope: 'global', kind: 'fact', confidence: 1.5 }).success).toBe(false);
      expect(CreateMemory.safeParse({ content: 'x', scope: 'global', kind: 'fact', confidence: -0.1 }).success).toBe(false);
    });
  });

  describe('UpdateMemory', () => {
    it('accepts a partial patch with no scope change', () => {
      expect(UpdateMemory.safeParse({ confidence: 0.4 }).success).toBe(true);
      expect(UpdateMemory.safeParse({}).success).toBe(true);
    });

    it('enforces the repo_id rule only when scope is supplied', () => {
      expect(UpdateMemory.safeParse({ scope: 'repo' }).success).toBe(false);
      expect(
        UpdateMemory.safeParse({ scope: 'repo', repo_id: '11111111-1111-4111-8111-111111111111' }).success,
      ).toBe(true);
      expect(UpdateMemory.safeParse({ scope: 'global' }).success).toBe(true);
    });

    it('rejects empty content when content is supplied', () => {
      expect(UpdateMemory.safeParse({ content: '' }).success).toBe(false);
    });
  });

  describe('MemoryListQuery', () => {
    it('coerces comma-separated scope/kind and a boolean stale from the query string', () => {
      const r = MemoryListQuery.safeParse({ scope: 'repo,global', kind: 'decision', stale: 'true' });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.scope).toEqual(['repo', 'global']);
        expect(r.data.kind).toEqual(['decision']);
        expect(r.data.stale).toBe(true);
      }
    });

    it('accepts a repeated-param array and an empty query', () => {
      const r = MemoryListQuery.safeParse({ scope: ['repo', 'team'] });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.scope).toEqual(['repo', 'team']);
      expect(MemoryListQuery.safeParse({}).success).toBe(true);
    });

    it('treats stale=false / absent as not stale', () => {
      const a = MemoryListQuery.safeParse({ stale: 'false' });
      expect(a.success && a.data.stale).toBe(false);
      const b = MemoryListQuery.safeParse({});
      expect(b.success && b.data.stale).toBeUndefined();
    });
  });
});
