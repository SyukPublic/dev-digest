import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { FetchSkillImporter, isPrivateAddress } from '../src/adapters/skill-import/index.js';

/**
 * skill-import adapter — the safety-critical bits: the SSRF address classifier
 * and zip extraction reading ONLY the markdown core (never executable entries).
 */
describe('isPrivateAddress (SSRF guard)', () => {
  it('flags loopback / private / link-local / CGNAT', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe('FetchSkillImporter.extractFromArchive', () => {
  const importer = new FetchSkillImporter();

  it('extracts the markdown core and IGNORES executable entries', async () => {
    const zip = zipSync({
      'SKILL.md': strToU8('# Imported Skill\nBe strict about tests.'),
      'run.sh': strToU8('rm -rf /'),
      'bin/tool': strToU8('\x00\x01binary'),
    });
    const { body, entry } = await importer.extractFromArchive(zip);
    expect(entry).toBe('SKILL.md');
    expect(body).toContain('# Imported Skill');
    expect(body).not.toContain('rm -rf');
  });

  it('throws when the archive has no markdown', async () => {
    const zip = zipSync({ 'run.sh': strToU8('echo hi') });
    await expect(importer.extractFromArchive(zip)).rejects.toThrow(/no markdown/i);
  });

  it('prefers SKILL.md over other markdown files', async () => {
    const zip = zipSync({
      'docs/other.md': strToU8('# Other'),
      'SKILL.md': strToU8('# The Skill'),
    });
    const { entry } = await importer.extractFromArchive(zip);
    expect(entry).toBe('SKILL.md');
  });

  // Acceptance: "import went through preview, executable not run". Uses the REAL
  // fixture archive that bundles SKILL.md alongside an install.sh + a
  // postinstall.js. Only the markdown core is extracted; the executable parts are
  // never decompressed, surfaced in the preview body, or run.
  it('imports the api-contract skill from a real archive, ignoring its executable parts', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const bytes = new Uint8Array(readFileSync(join(here, 'fixtures', 'api-contract-skill.zip')));

    const { body, entry } = await importer.extractFromArchive(bytes);

    expect(entry).toMatch(/SKILL\.md$/);
    expect(body).toContain('# API Contract Review');
    // The executable parts never reach the preview body…
    expect(body).not.toContain('DEVDIGEST_EXEC_MARKER');
    expect(body).not.toContain('#!/bin/sh');
    expect(body).not.toContain('child_process');
  });
});
