/**
 * Unit tests for the skill regression-label adapter (Phase 4, T23 / AC-27).
 *
 * `test_skill_dashboard` (alert slice) — the reused L06 `regressionAlert` output
 * ("… on v4") is adapted to name the SKILL ("… on skill v4") and to note a host
 * change between the two latest completed runs (a delta shift is confounded by
 * the host). The two-latest-completed logic itself stays in the pure scorer; this
 * is purely a label transform, so it needs no DB.
 */
import { describe, it, expect } from 'vitest';
import { adaptSkillAlert } from '../src/modules/eval/service.js';

const run = (hostAgentId: string, hostAgentVersion: number) => ({ hostAgentId, hostAgentVersion });

describe('adaptSkillAlert — AC-27 skill/host-aware label', () => {
  it('is null when the base alert is null (fewer than two completed / no regression)', () => {
    expect(adaptSkillAlert(null, run('a', 1), run('a', 1))).toBeNull();
    expect(adaptSkillAlert(null, undefined, undefined)).toBeNull();
  });

  it('rewrites "on v4" → "on skill v4" when the host is unchanged', () => {
    expect(adaptSkillAlert('Precision dipped 3pts on v4', run('a', 2), run('a', 2))).toBe(
      'Precision dipped 3pts on skill v4',
    );
  });

  it('appends "(host changed)" when the host AGENT differs between the two latest runs', () => {
    expect(adaptSkillAlert('Recall dipped 1pt on v7', run('b', 2), run('a', 2))).toBe(
      'Recall dipped 1pt on skill v7 (host changed)',
    );
  });

  it('appends "(host changed)" when only the host VERSION differs (same agent)', () => {
    expect(adaptSkillAlert('Citation dipped 2pts on v5', run('a', 3), run('a', 2))).toBe(
      'Citation dipped 2pts on skill v5 (host changed)',
    );
  });

  it('does not append the host note when both host id and version match', () => {
    expect(adaptSkillAlert('Precision dipped 5pts on v9', run('a', 4), run('a', 4))).toBe(
      'Precision dipped 5pts on skill v9',
    );
  });
});
