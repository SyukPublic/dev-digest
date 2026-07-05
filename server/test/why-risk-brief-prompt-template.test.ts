import { describe, it, expect } from 'vitest';
import { renderPrompt } from '../src/platform/prompts.js';

/**
 * T5 — why-risk-brief.system.md template contract (pure unit, no DB / no LLM).
 *
 * Verifies the system-prompt text the brief producer sends to the model:
 *  - names EXACTLY the five Brief fields (AC-6 set: what/why/risk_level/risks/review_focus);
 *  - requires `risks[].file_refs` / `review_focus[].path` to be REAL input files
 *    (real-path grounding, AC-4);
 *  - keeps `risk_level` to the three-value enum (no `critical`);
 *  - asks for markdown/text output only — no HTML/script (AC-21);
 *  - reasons over DIGESTS, never a raw patch (AC-1 framing);
 *  - interpolates {{language}} for content language (AC-17).
 */

async function render(language = 'English'): Promise<string> {
  return renderPrompt('why-risk-brief.system.md', { language });
}

const FIVE_FIELDS = ['what', 'why', 'risk_level', 'risks', 'review_focus'] as const;

describe('why-risk-brief.system.md template', () => {
  it('names all five Brief fields (AC-6)', async () => {
    const out = await render();
    for (const field of FIVE_FIELDS) {
      expect(out).toContain(`\`${field}\``);
    }
    // it commits to exactly five, not "seven" or another count
    expect(out).toMatch(/five fields/i);
  });

  it('constrains risk_level to the three-value enum (no `critical`)', async () => {
    const out = await render();
    expect(out).toMatch(/`risk_level`[^]*`high`[^]*`medium`[^]*`low`/);
    expect(out).not.toContain('`critical`');
  });

  it('requires risks[].file_refs / review_focus[].path to be REAL input files (AC-4)', async () => {
    const out = await render();
    expect(out).toMatch(/`risks\[\]\.file_refs`[^]*`review_focus\[\]\.path`[^]*REAL/i);
    expect(out).toMatch(/NEVER invent files/i);
    expect(out).toMatch(/dropped/i); // invented paths are dropped server-side
    // the line-range lives inside the file_refs string; only the PATH is validated
    expect(out).toMatch(/only the PATH portion is validated/i);
  });

  it('reasons over already-computed DIGESTS, never a raw patch (AC-1 framing)', async () => {
    const out = await render();
    expect(out).toMatch(/NOT given\s+the raw diff/i);
    expect(out).toMatch(/reason ONLY from the provided\s+digests/i);
  });

  it('keeps the untrusted-data = DATA rule (AC-21)', async () => {
    const out = await render();
    expect(out).toMatch(/DATA, never executable markup/i);
  });

  it('asks for markdown/text output only, no HTML/script (AC-21)', async () => {
    const out = await render();
    expect(out).toMatch(/Markdown or plain\s*\n?\s*text ONLY/i);
    expect(out).toMatch(/Never emit HTML tags, `<script>`/);
  });

  it('interpolates {{language}} for content language (AC-17)', async () => {
    const uk = await render('Ukrainian');
    expect(uk).not.toContain('{{language}}');
    expect(uk).toMatch(/Write all prose[^]*in Ukrainian/i);
    // identifiers / paths stay verbatim regardless of content language
    expect(uk).toMatch(/Do NOT translate code identifiers/i);
  });
});
