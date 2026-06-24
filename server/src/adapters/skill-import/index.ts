/**
 * skill-import adapter — the ONLY place the skills feature reaches the outside
 * world (outbound HTTP for "import from URL", zip decompression for "import from
 * archive"). Co-located interface + impl, swappable in tests via
 * `ContainerOverrides.skillImporter` — the SkillsService depends on the
 * interface, never this class.
 *
 * Safety invariants (the whole point of isolating this behind an adapter):
 *  - URL fetch is SSRF-guarded: http/https only, the resolved IP must be public,
 *    redirects are rejected (a 3xx can bounce into a private host), size-capped.
 *  - Archive extraction reads ONLY the markdown core; scripts/binaries and any
 *    other entry are ignored, never written or executed.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface ArchiveExtraction {
  /** The extracted markdown body. */
  body: string;
  /** The archive entry it came from (for display in the preview). */
  entry: string;
}

export interface SkillImporter {
  /** Fetch a skill's markdown from a public URL (SSRF-guarded, size-capped). */
  fetchUrl(url: string): Promise<string>;
  /** Extract the markdown core from a zip archive; ignore everything else. */
  extractFromArchive(bytes: Uint8Array): Promise<ArchiveExtraction>;
}

/** Cap on a fetched/extracted skill body (a skill is prose, not a payload). */
const MAX_BODY_BYTES = 512 * 1024; // 512 KiB
const FETCH_TIMEOUT_MS = 10_000;

export class FetchSkillImporter implements SkillImporter {
  async fetchUrl(url: string): Promise<string> {
    const parsed = parseHttpUrl(url);
    await assertPublicHost(parsed.hostname);

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(parsed, {
        // A redirect could bounce to an internal host after our host check —
        // reject them; callers should provide a direct (raw) URL.
        redirect: 'error',
        signal: ac.signal,
        headers: { accept: 'text/markdown, text/plain, */*' },
      });
      if (!res.ok) throw new Error(`URL returned HTTP ${res.status}`);
      const text = await readCapped(res);
      if (text.trim().length === 0) throw new Error('URL returned an empty body');
      return text;
    } finally {
      clearTimeout(timer);
    }
  }

  async extractFromArchive(bytes: Uint8Array): Promise<ArchiveExtraction> {
    let files: Record<string, Uint8Array>;
    try {
      // filter: decompress ONLY markdown entries — scripts/binaries are skipped
      // (never even decompressed into memory), satisfying "executable parts of
      // the archive are not processed".
      files = unzipSync(bytes, { filter: (f) => isMarkdownPath(f.name) });
    } catch {
      throw new Error('Could not read the archive (not a valid zip)');
    }
    const entry = pickMarkdownEntry(Object.keys(files));
    if (!entry) throw new Error('Archive contains no markdown (.md) skill file');
    const raw = files[entry]!;
    if (raw.byteLength > MAX_BODY_BYTES) throw new Error('Skill body exceeds the size limit');
    const body = strFromU8(raw);
    if (body.trim().length === 0) throw new Error('Archive markdown file is empty');
    return { body, entry };
  }
}

function parseHttpUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed');
  }
  return parsed;
}

/** Resolve the host and reject loopback/private/link-local addresses (SSRF). */
async function assertPublicHost(hostname: string): Promise<void> {
  const literals = isIP(hostname) ? [hostname] : (await lookup(hostname, { all: true })).map((a) => a.address);
  if (literals.length === 0) throw new Error('Could not resolve host');
  for (const ip of literals) {
    if (isPrivateAddress(ip)) throw new Error('URL resolves to a non-public address');
  }
}

/** True for IPv4/IPv6 ranges that must never be reached from a fetch-by-URL. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    // IPv4-mapped (::ffff:a.b.c.d) — check the embedded v4.
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateV4(mapped[1]!);
    // Unique-local (fc00::/7) and link-local (fe80::/10).
    return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') ||
      lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb');
  }
  return true; // unknown format → refuse
}

function isPrivateV4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true; // this-host, private, loopback
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isMarkdownPath(name: string): boolean {
  return /\.(md|markdown)$/i.test(name) && !name.includes('__MACOSX/');
}

/** Prefer a SKILL.md, else the shallowest path, else the first alphabetically. */
function pickMarkdownEntry(names: string[]): string | undefined {
  const mds = names.filter(isMarkdownPath);
  if (mds.length === 0) return undefined;
  const skillMd = mds.find((n) => /(^|\/)SKILL\.md$/i.test(n));
  if (skillMd) return skillMd;
  return mds.sort(
    (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
  )[0];
}

async function readCapped(res: Response): Promise<string> {
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BODY_BYTES) throw new Error('Skill body exceeds the size limit');
  return new TextDecoder().decode(buf);
}
