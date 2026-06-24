import type { ConventionDraft } from './helpers.js';

/**
 * Deterministic, no-LLM convention extraction from config files.
 *
 * Pure: the service reads the files and passes their raw contents in
 * (`{ [filename]: content | null }`); this returns the rules they imply with
 * `confidence: 1.0` and `source: 'config'`. These can't hallucinate — the file
 * IS the evidence — so they skip the snippet-verification gate downstream.
 *
 * Curated on purpose: we map a SUBSET of well-known settings to enforceable
 * reviewer rules rather than dumping every option. Unparseable files are skipped.
 */
export function extractConfigConventions(files: Record<string, string | null>): ConventionDraft[] {
  const drafts: ConventionDraft[] = [];
  const push = (
    rule: string,
    category: string,
    evidencePath: string,
    evidenceSnippet: string,
  ) => drafts.push({ rule, category, evidencePath, evidenceSnippet, confidence: 1, source: 'config', occurrences: null });

  // --- TypeScript (tsconfig.json) -----------------------------------------
  const tsconfig = parseJsonc(files['tsconfig.json']);
  const co = isRecord(tsconfig) && isRecord(tsconfig.compilerOptions) ? tsconfig.compilerOptions : undefined;
  if (co) {
    if (co.strict === true) push('Always keep TypeScript strict mode on', 'typescript', 'tsconfig.json', '"strict": true');
    if (co.noUncheckedIndexedAccess === true)
      push('Treat indexed access as possibly undefined (noUncheckedIndexedAccess)', 'typescript', 'tsconfig.json', '"noUncheckedIndexedAccess": true');
    if (co.noImplicitAny === true) push('Never use implicit any', 'typescript', 'tsconfig.json', '"noImplicitAny": true');
    if (co.exactOptionalPropertyTypes === true)
      push('Distinguish missing vs explicitly-undefined optional properties', 'typescript', 'tsconfig.json', '"exactOptionalPropertyTypes": true');
  }

  // --- Prettier (.prettierrc / .prettierrc.json / package.json#prettier) ---
  const prettier =
    parseJsonc(files['.prettierrc.json']) ??
    parseJsonc(files['.prettierrc']) ??
    prettierFromPackageJson(files['package.json']);
  if (isRecord(prettier)) {
    const at = prettierEvidencePath(files);
    if (prettier.singleQuote === true) push('Use single quotes', 'formatting', at, '"singleQuote": true');
    if (prettier.singleQuote === false) push('Use double quotes', 'formatting', at, '"singleQuote": false');
    if (prettier.semi === false) push('Omit semicolons', 'formatting', at, '"semi": false');
    if (prettier.semi === true) push('Always terminate statements with semicolons', 'formatting', at, '"semi": true');
    if (typeof prettier.printWidth === 'number') push(`Keep lines within ${prettier.printWidth} characters`, 'formatting', at, `"printWidth": ${prettier.printWidth}`);
    if (prettier.trailingComma === 'all') push('Use trailing commas everywhere', 'formatting', at, '"trailingComma": "all"');
    if (prettier.trailingComma === 'none') push('Never use trailing commas', 'formatting', at, '"trailingComma": "none"');
  }

  // --- ESLint (.eslintrc.json / .eslintrc) — curated rule subset ----------
  const eslint = parseJsonc(files['.eslintrc.json']) ?? parseJsonc(files['.eslintrc']);
  const rules = isRecord(eslint) && isRecord(eslint.rules) ? eslint.rules : undefined;
  if (rules) {
    const on = (name: string) => name in rules && !isOff(rules[name]);
    if (on('eqeqeq')) push('Use === instead of ==', 'lint', '.eslintrc.json', '"eqeqeq"');
    if (on('no-console')) push('Never leave console.* calls in committed code', 'lint', '.eslintrc.json', '"no-console"');
    if (on('@typescript-eslint/no-floating-promises'))
      push('Always handle promises (no floating promises)', 'lint', '.eslintrc.json', '"@typescript-eslint/no-floating-promises"');
    if (on('@typescript-eslint/no-explicit-any')) push('Never use the any type', 'lint', '.eslintrc.json', '"@typescript-eslint/no-explicit-any"');
    if (on('prefer-const')) push('Use const over let when a binding is never reassigned', 'lint', '.eslintrc.json', '"prefer-const"');
  }

  // --- Biome (biome.json) -------------------------------------------------
  const biome = parseJsonc(files['biome.json']);
  if (isRecord(biome)) {
    const fmt = isRecord(biome.javascript) && isRecord(biome.javascript.formatter) ? biome.javascript.formatter : undefined;
    if (fmt?.quoteStyle === 'single') push('Use single quotes', 'formatting', 'biome.json', '"quoteStyle": "single"');
    if (fmt?.quoteStyle === 'double') push('Use double quotes', 'formatting', 'biome.json', '"quoteStyle": "double"');
    const top = isRecord(biome.formatter) ? biome.formatter : undefined;
    if (top?.indentStyle === 'space') push('Indent with spaces', 'formatting', 'biome.json', '"indentStyle": "space"');
    if (top?.indentStyle === 'tab') push('Indent with tabs', 'formatting', 'biome.json', '"indentStyle": "tab"');
  }

  // --- EditorConfig (.editorconfig) — simple INI ---------------------------
  const ec = parseEditorConfig(files['.editorconfig']);
  if (ec.indent_style === 'tab') push('Indent with tabs', 'formatting', '.editorconfig', 'indent_style = tab');
  else if (ec.indent_style === 'space') {
    const size = ec.indent_size ? ` (${ec.indent_size})` : '';
    push(`Indent with spaces${size}`, 'formatting', '.editorconfig', `indent_style = space${ec.indent_size ? `\nindent_size = ${ec.indent_size}` : ''}`);
  }

  return drafts;
}

// --------------------------------------------------------------------------- helpers

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** An ESLint rule entry is "off" when it's 0 / "off" (or [0]/["off"]). */
function isOff(entry: unknown): boolean {
  const sev = Array.isArray(entry) ? entry[0] : entry;
  return sev === 0 || sev === 'off';
}

function prettierFromPackageJson(pkg: string | null | undefined): unknown {
  const parsed = parseJsonc(pkg);
  return isRecord(parsed) && isRecord(parsed.prettier) ? parsed.prettier : undefined;
}

function prettierEvidencePath(files: Record<string, string | null>): string {
  if (files['.prettierrc.json']) return '.prettierrc.json';
  if (files['.prettierrc']) return '.prettierrc';
  return 'package.json';
}

/**
 * Parse JSON that may contain comments + trailing commas (tsconfig, some
 * .prettierrc). Best-effort: returns undefined on any failure.
 */
export function parseJsonc(text: string | null | undefined): unknown {
  if (!text) return undefined;
  try {
    const noComments = text
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments (not "://")
    const noTrailingCommas = noComments.replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(noTrailingCommas);
  } catch {
    return undefined;
  }
}

/** Minimal .editorconfig reader — flat last-wins of the keys we care about. */
function parseEditorConfig(text: string | null | undefined): {
  indent_style?: string;
  indent_size?: string;
} {
  const out: { indent_style?: string; indent_size?: string } = {};
  if (!text) return out;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith('[')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const val = line.slice(eq + 1).trim().toLowerCase();
    if (key === 'indent_style') out.indent_style = val;
    else if (key === 'indent_size') out.indent_size = val;
  }
  return out;
}
