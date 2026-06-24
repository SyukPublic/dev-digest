/**
 * Regenerate `api-contract-skill.zip` from the source files in
 * `api-contract-skill/`. The archive bundles the markdown skill core alongside
 * "executable parts" (install.sh, postinstall.js) so the import path can be
 * tested: only SKILL.md is read, the executables are never processed or run.
 *
 *   node test/fixtures/make-api-contract-zip.mjs
 */
import { zipSync } from 'fflate';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'api-contract-skill');
const read = (name) => new Uint8Array(readFileSync(join(src, name)));

const zip = zipSync(
  {
    'SKILL.md': read('SKILL.md'),
    'install.sh': read('install.sh'),
    'scripts/postinstall.js': read('postinstall.js'),
  },
  { level: 6 },
);

const out = join(here, 'api-contract-skill.zip');
writeFileSync(out, zip);
console.log(`wrote ${out} (${zip.length} bytes)`);
