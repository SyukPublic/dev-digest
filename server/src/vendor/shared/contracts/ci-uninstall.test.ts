import { describe, it, expect } from 'vitest';
import { CiUninstallResult } from './ci-uninstall.js';

/**
 * test_ci_uninstall_contract (T1) — the uninstall response shape (AC-70/AC-74).
 * The `CiUninstallResult` confirms the row deletion + branch-cleanup outcome and
 * keeps `pr_url` nullable (no open PR on the branch is a valid result).
 */
describe('CiUninstallResult', () => {
  it('parses a complete uninstall result (one of many agents)', () => {
    const parsed = CiUninstallResult.parse({
      removed: true,
      repo: 'acme/api',
      agent_id: 'ag-1',
      branch_updated: true,
      pr_url: 'https://github.com/acme/api/pull/7',
      last_agent_removed: false,
    });
    expect(parsed.removed).toBe(true);
    expect(parsed.last_agent_removed).toBe(false);
    expect(parsed.pr_url).toBe('https://github.com/acme/api/pull/7');
  });

  it('accepts a null pr_url (no open export PR on the branch)', () => {
    const parsed = CiUninstallResult.parse({
      removed: true,
      repo: 'acme/api',
      agent_id: 'ag-1',
      branch_updated: true,
      pr_url: null,
      last_agent_removed: true,
    });
    expect(parsed.pr_url).toBeNull();
    expect(parsed.last_agent_removed).toBe(true);
  });

  it('rejects a missing boolean field', () => {
    const res = CiUninstallResult.safeParse({
      removed: true,
      repo: 'acme/api',
      agent_id: 'ag-1',
      pr_url: null,
      last_agent_removed: false,
    });
    expect(res.success).toBe(false);
  });

  it('rejects a non-nullable-shaped pr_url when omitted entirely', () => {
    const res = CiUninstallResult.safeParse({
      removed: true,
      repo: 'acme/api',
      agent_id: 'ag-1',
      branch_updated: true,
      last_agent_removed: false,
    });
    expect(res.success).toBe(false);
  });
});
