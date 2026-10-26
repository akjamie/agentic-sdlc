import path from 'node:path';
import { exists, readText } from './fs.js';
import { changeDir } from './paths.js';
import { assessRisk, RISK_LEVELS } from './risk.js';

export const LEVELS = RISK_LEVELS;

export function inferInitialLevel({ requirement = '', explicitLevel, repoRoot } = {}) {
  if (explicitLevel) {
    const norm = String(explicitLevel).toUpperCase();
    if (LEVELS[norm]) {
      return { level: norm, reason: `explicitly specified via --level ${norm}` };
    }
  }

  const assessment = assessRisk({ requirement, repoRoot });
  return {
    level: assessment.level,
    reason: assessment.reasons[0] || 'bounded local module change',
    assessment
  };
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

