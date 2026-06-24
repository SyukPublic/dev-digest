#!/usr/bin/env node
/**
 * Mirror the canonical `@devdigest/shared` contracts to the client's vendored copy.
 *
 * This repo is intentionally NOT a monorepo: each package owns its own
 * package.json + lockfile and resolves `@devdigest/shared` via a tsconfig path
 * alias. The server copy (`server/src/vendor/shared`) is the SINGLE SOURCE OF
 * TRUTH — the server authors the contracts and reviewer-core aliases straight to
 * it. The client keeps a SEPARATE vendored copy (it builds independently), which
 * silently drifts when a contract changes on only one side.
 *
 * This script copies server → client so the two never diverge. Run it after
 * editing any shared contract. CI runs it with `--check` to fail on drift.
 *
 *   node scripts/sync-shared.mjs           # write: mirror server → client
 *   node scripts/sync-shared.mjs --check   # verify: exit 1 if out of sync
 */
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'server', 'src', 'vendor', 'shared');
const DST = join(root, 'client', 'src', 'vendor', 'shared');

/** Relative paths of every file under `dir` (recursive). */
function listFiles(dir) {
  const out = [];
  const walk = (abs) => {
    for (const entry of readdirSync(abs)) {
      const p = join(abs, entry);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p));
    }
  };
  walk(dir);
  return out.sort();
}

const check = process.argv.includes('--check');
const srcFiles = listFiles(SRC);
const dstFiles = new Set(listFiles(DST));
const drift = [];

for (const rel of srcFiles) {
  const want = readFileSync(join(SRC, rel));
  const dstPath = join(DST, rel);
  dstFiles.delete(rel);
  const have = safeRead(dstPath);
  if (have === null || !want.equals(have)) {
    drift.push(rel);
    if (!check) {
      mkdirSync(dirname(dstPath), { recursive: true });
      writeFileSync(dstPath, want);
    }
  }
}
// Files present in the client copy but gone from the source = stale leftovers.
for (const rel of dstFiles) {
  drift.push(`${rel} (stale — not in source)`);
  if (!check) rmSync(join(DST, rel));
}

function safeRead(p) {
  try {
    return readFileSync(p);
  } catch {
    return null;
  }
}

if (check) {
  if (drift.length > 0) {
    console.error('@devdigest/shared is OUT OF SYNC (server → client). Drifted files:');
    for (const f of drift) console.error(`  - ${f}`);
    console.error('\nFix: run `node scripts/sync-shared.mjs` and commit the client copy.');
    process.exit(1);
  }
  console.log('@devdigest/shared is in sync (server === client).');
} else {
  console.log(
    drift.length > 0
      ? `Synced @devdigest/shared → client (${drift.length} file(s) updated).`
      : '@devdigest/shared already in sync — nothing to do.',
  );
}
