import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RepoRef } from '@devdigest/shared';
import { walkMarkdown } from '../src/modules/project-context/walk.js';
import {
  ProjectContextService,
  assertWithinClone,
} from '../src/modules/project-context/service.js';
import { ValidationError, NotFoundError } from '../src/platform/errors.js';
import type { Container } from '../src/platform/container.js';

/**
 * Phase 1 unit tests (no DB): the markdown walker glob, the AC-22 path-traversal
 * guard, and tokenize/read via the service over a real on-disk fixture clone.
 * A fake container wires a real fs-backed git client + a char/4 tokenizer so the
 * service exercises the true discover/read/tokenize path without Postgres.
 */

const ROOTS = ['specs', 'docs', 'insights'] as const;
const HARD_CAP = 256 * 1024;

// ---- On-disk fixture clone --------------------------------------------------
let cloneRoot: string;

async function write(rel: string, content: string) {
  const abs = join(cloneRoot, rel);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, content, 'utf8');
}

beforeAll(async () => {
  cloneRoot = await mkdtemp(join(tmpdir(), 'pc-clone-'));
  // Markdown under configured roots (any depth) — should be discovered.
  await write('specs/foo.md', '# Foo spec\nhello world');
  await write('docs/nested/deep/bar.md', '# Bar');
  await write('insights/notes.md', 'notes');
  await write('docs/empty.md', ''); // empty → 0 tokens
  // NON-markdown / outside roots / excluded dir — should NOT be discovered.
  await write('specs/readme.txt', 'not markdown');
  await write('README.md', '# top-level, not under a root');
  await write('src/code.md', '# under an unconfigured root');
  await write('docs/node_modules/pkg/skip.md', '# in an excluded dir');
});

afterAll(async () => {
  await rm(cloneRoot, { recursive: true, force: true });
});

// ---- Fake container ---------------------------------------------------------
const REF: RepoRef = { owner: 'acme', name: 'widgets' };

function fakeContainer(overrides?: {
  roots?: string[];
  clonePath?: string;
  repo?: { owner: string; name: string } | undefined;
}): Container {
  const clonePath = overrides?.clonePath ?? cloneRoot;
  return {
    config: {
      projectContextRoots: overrides?.roots ?? [...ROOTS],
      projectContextFileHardCapBytes: HARD_CAP,
    },
    git: {
      clonePathFor: (_r: RepoRef) => clonePath,
      readFile: async (_r: RepoRef, path: string) => {
        const { readFile } = await import('node:fs/promises');
        return readFile(join(clonePath, path), 'utf8');
      },
    },
    tokenizer: { count: (text: string) => Math.ceil(text.length / 4) },
    reposRepo: {
      getById: async (_ws: string, _id: string) =>
        overrides && 'repo' in overrides
          ? overrides.repo
          : { owner: REF.owner, name: REF.name },
    },
  } as unknown as Container;
}

describe('walkMarkdown (T1 — discover glob)', () => {
  it('returns ONLY *.md under the configured roots, at any depth', async () => {
    const docs = await walkMarkdown(cloneRoot, [...ROOTS], HARD_CAP);
    const paths = docs.map((d) => d.path);
    expect(paths).toEqual([
      'docs/empty.md',
      'docs/nested/deep/bar.md',
      'insights/notes.md',
      'specs/foo.md',
    ]);
    // excluded: .txt, top-level README.md, src/code.md, node_modules
    expect(paths).not.toContain('README.md');
    expect(paths).not.toContain('src/code.md');
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false);
    expect(paths.some((p) => p.endsWith('.txt'))).toBe(false);
  });

  it('tags each doc with folder_type = its owning root', async () => {
    const docs = await walkMarkdown(cloneRoot, [...ROOTS], HARD_CAP);
    const byPath = Object.fromEntries(docs.map((d) => [d.path, d.folderType]));
    expect(byPath['specs/foo.md']).toBe('specs');
    expect(byPath['docs/nested/deep/bar.md']).toBe('docs');
    expect(byPath['insights/notes.md']).toBe('insights');
  });

  it('returns empty (never throws) when the roots are absent (AC-16)', async () => {
    const docs = await walkMarkdown(cloneRoot, ['does-not-exist'], HARD_CAP);
    expect(docs).toEqual([]);
  });

  it('returns empty when the whole clone is missing (AC-16)', async () => {
    const docs = await walkMarkdown(join(cloneRoot, 'no', 'such', 'clone'), [...ROOTS], HARD_CAP);
    expect(docs).toEqual([]);
  });

  it('skips a file over the per-file byte cap (never returned)', async () => {
    const docs = await walkMarkdown(cloneRoot, [...ROOTS], 4); // 4-byte cap
    // Only the empty file (0 bytes) and "# Bar"(5)/"notes"(5) — check the big one is gone.
    expect(docs.map((d) => d.path)).not.toContain('specs/foo.md');
    expect(docs.map((d) => d.path)).toContain('docs/empty.md');
  });
});

describe('ProjectContextService.discover (T1)', () => {
  it('discovers docs with token counts; empty file → 0 tokens (AC-8, AC-23)', async () => {
    const svc = new ProjectContextService(fakeContainer());
    const docs = await svc.discover('ws1', 'repo1');
    const byPath = Object.fromEntries(docs.map((d) => [d.path, d]));
    expect(byPath['docs/empty.md']!.tokens).toBe(0);
    expect(byPath['specs/foo.md']!.tokens).toBeGreaterThan(0);
    expect(byPath['specs/foo.md']!.folder_type).toBe('specs');
  });

  it('degrades to empty when the clone path does not exist (AC-16)', async () => {
    const svc = new ProjectContextService(
      fakeContainer({ clonePath: join(cloneRoot, 'ghost') }),
    );
    expect(await svc.discover('ws1', 'repo1')).toEqual([]);
  });

  it('404s when the repo is not in the workspace (AC-20)', async () => {
    const svc = new ProjectContextService(fakeContainer({ repo: undefined }));
    await expect(svc.discover('ws1', 'missing')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ProjectContextService.content (T2 — document content)', () => {
  it('returns raw UTF-8 markdown + token count for a listed doc (AC-2, AC-8)', async () => {
    const svc = new ProjectContextService(fakeContainer());
    const res = await svc.content('ws1', 'repo1', 'specs/foo.md');
    expect(res.content).toBe('# Foo spec\nhello world');
    expect(res.folder_type).toBe('specs');
    expect(res.tokens).toBe(Math.ceil('# Foo spec\nhello world'.length / 4));
  });

  it('tokens are 0 for an empty file (AC-8)', async () => {
    const svc = new ProjectContextService(fakeContainer());
    const res = await svc.content('ws1', 'repo1', 'docs/empty.md');
    expect(res.content).toBe('');
    expect(res.tokens).toBe(0);
  });

  it('404s for a dangling path (AC-2)', async () => {
    const svc = new ProjectContextService(fakeContainer());
    await expect(svc.content('ws1', 'repo1', 'docs/nope.md')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('path-traversal guard (T3 — AC-22)', () => {
  it('assertWithinClone rejects ../ escapes and absolute paths', () => {
    const root = join(cloneRoot);
    expect(() => assertWithinClone(root, '../secret.md')).toThrow(ValidationError);
    expect(() => assertWithinClone(root, 'docs/../../secret.md')).toThrow(ValidationError);
    expect(() => assertWithinClone(root, '/etc/passwd')).toThrow(ValidationError);
    // A legitimate descendant passes.
    expect(() => assertWithinClone(root, 'specs/foo.md')).not.toThrow();
    expect(() => assertWithinClone(root, 'docs/nested/deep/bar.md')).not.toThrow();
  });

  it('service.content rejects a traversal path BEFORE reading (422, no read)', async () => {
    let readCalled = false;
    const container = fakeContainer();
    // Spy on readFile to prove no read happens on a rejected path.
    (container.git as { readFile: unknown }).readFile = async () => {
      readCalled = true;
      return 'SHOULD NOT BE READ';
    };
    const svc = new ProjectContextService(container);
    await expect(svc.content('ws1', 'repo1', '../../etc/passwd')).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(readCalled).toBe(false);
  });
});
