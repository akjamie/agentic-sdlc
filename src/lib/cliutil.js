import path from 'node:path';
import { resolveRepoRoot, openspecDir } from './paths.js';
import { exists, readText } from './fs.js';
import { readYaml } from './yaml.js';
import { fail } from './errors.js';

export function toChangeSlug(changeId) {
  return String(changeId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function extractRequirementTerms(text) {
  const s = String(text ?? '')
    .replace(/\b[A-Za-z]{2,10}-\d+\b[:\s-]*/g, '')
    .toLowerCase()
    .replace(/\b(i\s+want\s+to\s+build|i\s+want\s+to\s+add|i\s+want\s+to|we\s+need\s+to|please\s+add|build|create|add|implement)\b/gi, '')
    .replace(/\b(a|an|the|of|for|with|in|on|to|and|by)\b/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();
  const words = s.split(/\s+/).filter(Boolean);
  return words.slice(0, 5).join(' ');
}

export function deriveChangeSlug(input, opts = {}) {
  if (opts.id) return toChangeSlug(opts.id);
  const text = String(input ?? '').trim();
  if (!text) return 'change';

  // If already a short alphanumeric ID or slug (e.g. TECH-1234 or rate-limiting) without spaces
  if (!text.includes(' ') && text.length <= 40 && /^[a-zA-Z0-9_-]+$/.test(text)) {
    return toChangeSlug(text);
  }

  // Extract ticket ID if present (e.g. "TECH-1234: i want to build...")
  const ticketMatch = text.match(/\b([A-Za-z]{2,10}-\d+)\b/);
  const ticket = ticketMatch ? ticketMatch[1].toLowerCase() : null;

  // Strip filler phrases and ticket prefix
  let cleaned = text
    .replace(/\b[A-Za-z]{2,10}-\d+\b[:\s-]*/g, '')
    .toLowerCase()
    .replace(/\b(i\s+want\s+to\s+build|i\s+want\s+to\s+add|i\s+want\s+to|we\s+need\s+to|please\s+add|build|create|add|implement)\b/gi, '')
    .replace(/\b(a|an|the|of|for|with|in|on|to|and|by)\b/gi, '')
    .trim();

  if (!cleaned) cleaned = text.toLowerCase();

  const words = cleaned
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);

  const keywords = words.join('-');
  if (ticket && keywords) return `${ticket}-${keywords}`.slice(0, 40).replace(/-+$/, '');
  if (ticket) return ticket;
  if (keywords) return keywords.slice(0, 40).replace(/-+$/, '');
  const fallback = toChangeSlug(text).slice(0, 40);
  if (fallback) return fallback;

  // Non-ASCII fallback (e.g. pure Chinese input): generate deterministic slug from content hash
  const hash = Math.abs(text.split('').reduce((acc, c) => ((acc << 5) - acc) + c.charCodeAt(0), 0)).toString(36);
  return `change-${hash || Date.now().toString(36)}`;
}

export function requireRepo(opts = {}) {
  const repoRoot = resolveRepoRoot(opts);
  if (!exists(openspecDir(repoRoot))) {
    fail(`no OpenSpec project found at ${repoRoot}`, {
      code: 'NOT_INITIALIZED',
      hint: 'Run `asdlc init` first.',
    });
  }
  return repoRoot;
}

export function jsonOut(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

// Policy-as-code for the lint harness: severities live in the repo's
// openspec/config.yaml so a BU can tune policy without forking the tool.
export function readLintConfig(repoRoot) {
  const cfg = path.join(openspecDir(repoRoot), 'config.yaml');
  const empty = { rules: {}, version: null };
  if (!exists(cfg)) return empty;
  try {
    const parsed = readYaml(cfg) ?? {};
    const lint = parsed.lint ?? {};
    return {
      rules: typeof lint.rules === 'object' && lint.rules !== null ? lint.rules : {},
      version: typeof lint.version === 'string' ? lint.version : null,
    };
  } catch {
    return empty;
  }
}
