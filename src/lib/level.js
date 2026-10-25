import path from 'node:path';
import { exists, readText } from './fs.js';
import { changeDir } from './paths.js';
import { DEFAULT_POLICY, loadPolicy } from './policy.js';

export const LEVELS = {
  L0: 'L0',
  L1: 'L1',
  L2: 'L2',
  L3: 'L3',
};

export const SENSITIVE_KEYWORDS = [
  'auth', 'password', 'secret', 'token', 'permission', 'crypto', 'credential',
  'jwt', 'session', 'oauth', 'rbac', 'iam', 'key'
];

export const BOUNDARY_KEYWORDS = [
  'api', 'database', 'migration', 'schema', 'openapi', 'rest', 'grpc',
  'config', 'docker', 'k8s', 'workflow', 'deploy', 'table', 'model'
];

export const TRIVIAL_KEYWORDS = [
  'doc', 'docs', 'typo', 'readme', 'comment', 'formatting', 'whitespace'
];

export function inferInitialLevel({ requirement = '', explicitLevel, repoRoot, policy } = {}) {
  if (explicitLevel) {
    const norm = String(explicitLevel).toUpperCase();
    if (LEVELS[norm]) {
      return { level: norm, reason: `explicitly specified via --level ${norm}` };
    }
  }

  const pol = policy ?? (repoRoot ? loadPolicy(repoRoot) : DEFAULT_POLICY);
  const text = String(requirement).toLowerCase();

  // 1. Check L3 Sensitive Keywords
  for (const kw of SENSITIVE_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, 'i');
    if (re.test(text)) {
      return { level: LEVELS.L3, reason: `touches security/sensitive domain keyword '${kw}'` };
    }
  }

  // 2. Check L2 Boundary Keywords
  for (const kw of BOUNDARY_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, 'i');
    if (re.test(text)) {
      return { level: LEVELS.L2, reason: `touches cross-boundary/infrastructure keyword '${kw}'` };
    }
  }

  // 3. Check L0 Trivial Keywords
  for (const kw of TRIVIAL_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, 'i');
    if (re.test(text)) {
      return { level: LEVELS.L0, reason: `trivial change matching keyword '${kw}'` };
    }
  }

  // 4. Default: L1 Bounded Change
  return { level: LEVELS.L1, reason: 'bounded local module change' };
}

export function isSinglePrLevel(level) {
  return level === LEVELS.L0 || level === LEVELS.L1;
}

export function requiresHumanReview(level, opts = {}) {
  if (level === LEVELS.L3) return true;
  if (level === LEVELS.L2) return !Boolean(opts?.contractTestVerified);
  return false;
}

export function readChangeLevel(repoRoot, changeId) {
  if (!repoRoot || !changeId) return null;
  const cdir = changeDir(repoRoot, changeId);
  const metaPath = path.join(cdir, '.openspec.yaml');
  if (!exists(metaPath)) return null;
  const metaText = readText(metaPath);
  const m = metaText.match(/^\s*level:\s*['"]?([^\s'"]+)['"]?\s*$/m);
  return m ? m[1].toUpperCase() : null;
}
