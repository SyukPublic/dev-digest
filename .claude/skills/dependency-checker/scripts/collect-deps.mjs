#!/usr/bin/env node
/**
 * collect-deps.mjs — deterministic dependency collector for the `dependency-checker` skill.
 *
 * The skill's report needs the same facts every time: which components exist, what each declares,
 * how big each installed package is, which deps are internal (path-alias / cross-package) vs
 * external npm, where versions drift, and which declared deps are never imported. Gathering that
 * by hand (Read + Bash `du` + Grep) is fiddly and differs run-to-run — so it lives here once,
 * cross-platform (pure Node, no deps, no `du`/`grep` shell-outs), and the skill just reads the
 * output.
 *
 * Usage:
 *   node .claude/skills/dependency-checker/scripts/collect-deps.mjs [rootDir] [--json]
 *
 *   rootDir   repo root to analyze (default: process.cwd())
 *   --json    emit a JSON object instead of the human-readable Markdown block
 *
 * This tool is READ-ONLY: it never installs, removes, or edits anything. Sizes are the package's
 * own installed footprint (approximate — symlinks are not followed, so transitive deps are NOT
 * double-counted); "possibly unused" and cross-package findings are best-effort heuristics the
 * skill must confirm, not execute.
 */

import { readFileSync, readdirSync, existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep, dirname } from "node:path";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage", ".turbo", "out",
  "clones", ".cache", "results", ".pnpm",
]);
const SRC_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const root = resolve(args.find((a) => !a.startsWith("--")) ?? process.cwd());

// --- generic fs walk (skips heavy/generated dirs; never follows symlinks) ---------------------

function* walk(dir, { maxDepth = Infinity, depth = 0 } = {}) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      if (depth < maxDepth) yield* walk(full, { maxDepth, depth: depth + 1 });
    } else if (e.isFile()) {
      yield full;
    }
  }
}

// --- tolerant JSON (tsconfig / package.json may carry comments + trailing commas) -------------

function readJsonLoose(file) {
  try {
    const raw = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// --- discover components (each package.json outside node_modules = one component) -------------

function discoverComponents() {
  const comps = [];
  const rootPkg = join(root, "package.json");
  const seen = new Set();
  const add = (pkgFile) => {
    if (seen.has(pkgFile)) return;
    const pkg = readJsonLoose(pkgFile);
    if (!pkg) return;
    seen.add(pkgFile);
    const dir = dirname(pkgFile);
    comps.push({
      name: pkg.name || relative(root, dir).split(sep)[0] || "root",
      dir,
      rel: relative(root, dir) || ".",
      pkg,
    });
  };
  if (existsSync(rootPkg)) add(rootPkg);
  // Only look one level deep for sub-package.jsons — this repo keeps each package at the top level.
  for (const entry of safeReaddir(root)) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    const p = join(root, entry.name, "package.json");
    if (existsSync(p)) add(p);
  }
  return comps.sort((a, b) => a.rel.localeCompare(b.rel));
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// --- installed size of one dependency (own footprint, symlinks not followed) ------------------

function resolveDepDir(compDir, dep) {
  for (const base of [join(compDir, "node_modules"), join(root, "node_modules")]) {
    const p = join(base, ...dep.split("/"));
    if (existsSync(p)) {
      try {
        return realpathSync(p);
      } catch {
        return p;
      }
    }
  }
  return null;
}

function dirSize(dir) {
  let bytes = 0;
  const rootReal = safeReal(dir);
  const stack = [dir];
  const visited = new Set();
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(cur, e.name);
      if (e.isSymbolicLink()) continue; // don't follow → no transitive double-counting / loops
      if (e.isDirectory()) {
        const real = safeReal(full);
        if (!real.startsWith(rootReal)) continue; // stayed inside this package only
        if (visited.has(real)) continue;
        visited.add(real);
        stack.push(full);
      } else if (e.isFile()) {
        try {
          bytes += lstatSync(full).size;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return bytes;
}

function safeReal(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function humanSize(bytes) {
  if (bytes == null) return "n/a";
  const u = ["B", "K", "M", "G"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)}${u[i]}`;
}

// --- imports found in a component's own source ------------------------------------------------

const IMPORT_RE =
  /(?:import\s+(?:[\s\S]*?\s+from\s+)?|export\s+[\s\S]*?\s+from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;

function scanImports(compDir) {
  const specs = new Map(); // specifier -> Set(relative files)
  for (const file of walk(compDir, { maxDepth: 12 })) {
    if (!SRC_EXT.test(file)) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1];
      if (!specs.has(spec)) specs.set(spec, new Set());
      specs.get(spec).add(relative(root, file));
    }
  }
  return specs;
}

// bare package name from an import specifier ("@scope/x/sub" -> "@scope/x", "x/y" -> "x")
function bareName(spec) {
  if (spec.startsWith(".") || spec.startsWith("/")) return null;
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

// --- main -------------------------------------------------------------------------------------

const components = discoverComponents();

const report = {
  root,
  components: [],
  versionDrift: [], // { dep, versions: [{component, version}] }
  internal: [], // { from, spec, files, kind }  (alias | cross-package-relative | package-name)
  possiblyUnused: [], // { component, dep }
};

const componentNames = new Set(components.map((c) => c.name));
const versionMap = new Map(); // dep -> Map(version -> Set(component))

for (const c of components) {
  const deps = c.pkg.dependencies || {};
  const devDeps = c.pkg.devDependencies || {};
  const aliases = readAliases(c.dir);
  const specs = scanImports(c.dir);
  const importedBare = new Set(
    [...specs.keys()].map(bareName).filter(Boolean),
  );

  // sizes for declared deps (runtime first — they ship; dev is informational)
  const sized = {};
  for (const [name, version] of [...Object.entries(deps), ...Object.entries(devDeps)]) {
    const dir = resolveDepDir(c.dir, name);
    sized[name] = { version, bytes: dir ? dirSize(dir) : null, dev: !(name in deps) };
    const vm = versionMap.get(name) ?? new Map();
    const set = vm.get(version) ?? new Set();
    set.add(c.name);
    vm.set(version, set);
    versionMap.set(name, vm);
  }

  // possibly-unused runtime deps: declared, but no bare import of it anywhere in this component's src.
  // (Heuristic: type-only, plugin, and config-referenced deps may be false positives — the skill confirms.)
  for (const name of Object.keys(deps)) {
    if (!importedBare.has(name)) report.possiblyUnused.push({ component: c.name, dep: name });
  }

  // internal links: alias imports, cross-package relative imports, and imports by another component's name
  for (const [spec, files] of specs) {
    const rels = [...files];
    if (spec.startsWith(".")) {
      // resolve against the file that imported it; cross-package if it lands in another component
      for (const relFile of rels) {
        const resolved = resolve(root, dirname(relFile), spec);
        const owner = components.find(
          (o) => o.dir !== c.dir && (resolved === o.dir || resolved.startsWith(o.dir + sep)),
        );
        if (owner) {
          const deep = /(^|[\\/])(src|lib|dist)[\\/]/.test(relative(owner.dir, resolved) + sep);
          report.internal.push({
            from: c.name,
            to: owner.name,
            spec,
            file: relFile,
            kind: deep ? "cross-package-relative-deep" : "cross-package-relative",
          });
        }
      }
      continue;
    }
    const bn = bareName(spec);
    const aliasHit = Object.keys(aliases).find(
      (a) => spec === a || spec.startsWith(a.replace(/\*$/, "")),
    );
    if (aliasHit) {
      report.internal.push({ from: c.name, to: aliases[aliasHit], spec, files: rels, kind: "alias" });
    } else if (bn && componentNames.has(bn) && bn !== c.name) {
      report.internal.push({ from: c.name, to: bn, spec, files: rels, kind: "package-name" });
    }
  }

  report.components.push({
    name: c.name,
    path: relative(root, join(c.dir, "package.json")) || "package.json",
    dependencies: deps,
    devDependencies: devDeps,
    aliases,
    sizes: sized,
  });
}

// version drift: same dep declared at 2+ distinct versions across components
for (const [dep, vm] of versionMap) {
  if (vm.size > 1) {
    report.versionDrift.push({
      dep,
      versions: [...vm.entries()].map(([version, comps]) => ({ version, components: [...comps] })),
    });
  }
}

function readAliases(compDir) {
  const out = {};
  const tsconfig = readJsonLoose(join(compDir, "tsconfig.json"));
  const paths = tsconfig?.compilerOptions?.paths;
  if (paths) for (const [k, v] of Object.entries(paths)) out[k] = Array.isArray(v) ? v[0] : v;
  return out;
}

// --- Mermaid graph ------------------------------------------------------------------------------
// A deterministic `flowchart LR` the skill pastes into the report's "Dependency graph" section,
// so the graph never depends on the model redrawing it correctly. Conventions (mirrored in the
// skill's report template): internal links = solid edges, deep imports into another package's
// internals = thick `==>` edges (P0 candidates — thick avoids index-fragile linkStyle), external
// npm deps = dotted edges to stadium leaf nodes with the installed size in the label.

const MERMAID_EXT_CAP = 8; // total external leaf nodes (keeps the graph under ~20 nodes)
const MERMAID_TOP_PER_COMP = 3; // heaviest runtime deps considered per component

function buildMermaid(report) {
  // Package names carry @ / . - which are illegal in Mermaid node IDs — sanitize, and
  // collision-proof the result (`@devdigest/web` and `devdigest-web` would both yield the same id).
  const ids = new Map();
  const used = new Set();
  const idFor = (name) => {
    if (ids.has(name)) return ids.get(name);
    const base = name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+|_+$/g, "") || "pkg";
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}_${i}`;
    used.add(id);
    ids.set(name, id);
    return id;
  };
  const extId = (dep) => idFor(`ext:${dep}`);

  const L = ["flowchart LR"];
  L.push("  subgraph internal[Internal packages]");
  for (const c of report.components) L.push(`    ${idFor(c.name)}["${c.name}"]`);
  L.push("  end");

  // internal edges, deduped by from|to|kind
  const edges = new Map();
  for (const i of report.internal) {
    const key = `${i.from}|${i.to}|${i.kind}`;
    if (!edges.has(key)) edges.set(key, i);
  }
  for (const e of edges.values()) {
    const deep = e.kind === "cross-package-relative-deep";
    const label =
      e.kind === "alias" ? `alias ${e.spec}` :
      deep ? "deep import (P0 candidate)" :
      e.kind === "cross-package-relative" ? "relative import" : e.spec;
    L.push(`  ${idFor(e.from)} ${deep ? "==>" : "-->"}|"${label}"| ${idFor(e.to)}`);
  }

  // external npm deps: per component take the heaviest runtime deps, then keep only the
  // globally heaviest MERMAID_EXT_CAP of them so the graph stays readable (~20 nodes max)
  const compNames = new Set(report.components.map((c) => c.name));
  const candidates = new Map(); // dep -> { bytes: max known, edges: Set(from) }
  for (const c of report.components) {
    const runtime = Object.entries(c.sizes)
      .filter(([dep, s]) => !s.dev && !compNames.has(dep))
      .sort((a, b) => (b[1].bytes ?? -1) - (a[1].bytes ?? -1))
      .slice(0, MERMAID_TOP_PER_COMP);
    for (const [dep, s] of runtime) {
      const cand = candidates.get(dep) ?? { bytes: null, edges: new Set() };
      if (s.bytes != null && (cand.bytes == null || s.bytes > cand.bytes)) cand.bytes = s.bytes;
      cand.edges.add(c.name);
      candidates.set(dep, cand);
    }
  }
  const kept = [...candidates.entries()]
    .sort((a, b) => (b[1].bytes ?? -1) - (a[1].bytes ?? -1))
    .slice(0, MERMAID_EXT_CAP);
  for (const [dep, cand] of kept) {
    const size = cand.bytes != null ? ` ${humanSize(cand.bytes)}` : "";
    L.push(`  ${extId(dep)}(["${dep}${size}"])`);
    for (const from of cand.edges) L.push(`  ${idFor(from)} -.->|npm| ${extId(dep)}`);
  }
  return L.join("\n");
}

report.mermaid = buildMermaid(report);

// --- output -----------------------------------------------------------------------------------

if (asJson) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exit(0);
}

const L = [];
L.push(`# Dependency data (collected by collect-deps.mjs)`);
L.push(``);
L.push(`Root: ${report.root}`);
L.push(`Components: ${report.components.map((c) => c.name).join(", ") || "(none found)"}`);
L.push(``);

L.push(`## Dependency graph (Mermaid)`);
L.push(`Ready to paste into the report's "Dependency graph" section (trim externals if noisy).`);
L.push("```mermaid");
L.push(report.mermaid);
L.push("```");
L.push(``);

L.push(`## Declared dependencies`);
for (const c of report.components) {
  L.push(`### ${c.name}  (${c.path})`);
  const rt = Object.entries(c.dependencies).map(([n, v]) => `${n}@${v}`);
  const dv = Object.entries(c.devDependencies).map(([n, v]) => `${n}@${v}`);
  L.push(`- runtime: ${rt.join(", ") || "(none)"}`);
  L.push(`- dev: ${dv.join(", ") || "(none)"}`);
  if (Object.keys(c.aliases).length)
    L.push(`- path aliases: ${Object.entries(c.aliases).map(([k, v]) => `${k} -> ${v}`).join(", ")}`);
}
L.push(``);

L.push(`## Installed sizes (approx own footprint)`);
L.push(`| component | dependency | version | scope | size |`);
L.push(`|---|---|---|---|---|`);
for (const c of report.components) {
  const rows = Object.entries(c.sizes).sort((a, b) => (b[1].bytes ?? -1) - (a[1].bytes ?? -1));
  for (const [name, s] of rows) {
    L.push(`| ${c.name} | ${name} | ${s.version} | ${s.dev ? "dev" : "runtime"} | ${humanSize(s.bytes)} |`);
  }
}
L.push(``);

L.push(`## Internal / cross-package links`);
if (!report.internal.length) L.push(`- (none detected)`);
for (const i of report.internal) {
  const where = i.file ? ` in ${i.file}` : i.files ? ` (${i.files.length} file(s))` : "";
  L.push(`- [${i.kind}] ${i.from} -> ${i.to} via \`${i.spec}\`${where}`);
}
L.push(``);

L.push(`## Version drift (same dep, different versions)`);
if (!report.versionDrift.length) L.push(`- (none)`);
for (const d of report.versionDrift) {
  L.push(`- ${d.dep}: ${d.versions.map((v) => `${v.version} (${v.components.join(", ")})`).join(" | ")}`);
}
L.push(``);

L.push(`## Possibly unused runtime deps (declared, no bare import found in src — CONFIRM before acting)`);
if (!report.possiblyUnused.length) L.push(`- (none detected)`);
for (const u of report.possiblyUnused) L.push(`- ${u.component}: ${u.dep}`);
L.push(``);

process.stdout.write(L.join("\n") + "\n");
