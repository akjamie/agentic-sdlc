import path from 'node:path';
import { exists } from './fs.js';
import { readYaml } from './yaml.js';

// Platform-owned strategy file (v6 7.3). Loaded from .sdlc/policy.yaml.
export const POLICY_REL = '.sdlc/policy.yaml';

export const DEFAULT_POLICY = {
  locked_paths: ['openspec/changes/*/proposal.md', 'openspec/changes/*/specs/**'],
  controlled: ['openspec/changes/*/design.md'],
  fast_path: { allow_paths: ['docs/**'], allow_kinds: [] },
  reviewers: { spec: null, design: null },
  ai_review: { trigger: 'on-ready-and-push', debounce_seconds: 120 },
  rollout_mode: {},
  web_search: 'allow',
};

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    const a = base[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a && typeof a === 'object' && !Array.isArray(a)
      ? deepMerge(a, v) : v;
  }
  return out;
}

export function loadPolicy(repoRoot) {
  const p = path.join(repoRoot, POLICY_REL);
  if (!exists(p)) return { ...DEFAULT_POLICY };
  try {
    return deepMerge(DEFAULT_POLICY, readYaml(p) ?? {});
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

// Gitignore-style glob: * = within a segment, ** = across segments.
export function globToRe(glob) {
  const s = String(glob)
    .replace(/[.+^${}()|[\]\\?]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${s}$`);
}

export function matchesAny(p, globs = []) {
  return globs.some((g) => globToRe(g).test(p));
}

// rollout_mode: checkName -> 'block' | 'advisory'. Missing => block.
export function isAdvisory(policy, checkName) {
  return policy?.rollout_mode?.[checkName] === 'advisory';
}

// Web-search policy egress guard: enabled by default ('allow'), blocked only when explicitly 'deny'.
export function canWebSearch(policy) {
  return policy?.web_search !== 'deny';
}
