import path from 'node:path';
import { exists, readText } from './fs.js';
import { changeDir } from './paths.js';
import { assess, loadMaxHistoryLevel } from '../assess/index.js';
import { RISK_LEVELS, LEVEL_RANK } from '../assess/rules/builtin.js';
import { fail } from './errors.js';

export const LEVELS = RISK_LEVELS;

export function inferInitialLevel({ requirement = '', explicitLevel, repoRoot, changeId } = {}) {
  // Always run assessment to establish immutable baseline in history
  const result = assess({
    stage: 'new',
    changeId: changeId || 'provisional',
    requirement,
    repoRoot,
    persist: Boolean(repoRoot && changeId)
  });

  const systemLevel = result.risk.level;
  let finalLevel = systemLevel;
  let reason = 'bounded local module change';

  const allEvidence = [
    ...(result.vectors.v2_security.evidence || []),
    ...(result.vectors.v3_topology.evidence || []),
    ...(result.vectors.v1_intent.evidence || [])
  ];
  if (allEvidence.length > 0) {
    reason = allEvidence[0].summary;
  } else if (result.reason_codes && result.reason_codes.length > 0) {
    reason = result.reason_codes[0];
  }

  if (explicitLevel) {
    const norm = String(explicitLevel).toUpperCase();
    if (LEVELS[norm]) {
      const explicitRank = LEVEL_RANK[norm] ?? 1;
      const systemRank = LEVEL_RANK[systemLevel] ?? 1;
      if (explicitRank < systemRank) {
        fail(`cannot downgrade governance level to ${norm}: system evaluation strictly rated requirement as ${systemLevel} (${reason})`, {
          code: 'ILLEGAL_DOWNGRADE',
          hint: 'Level ratings are automated system invariants. Raise a system rule bug if the rating is inaccurate.'
        });
      }
      finalLevel = norm;
      reason = `explicitly specified via --level ${norm}`;
    }
  }

  const isSpecFirst = finalLevel === 'L2' || finalLevel === 'L3';
  return {
    level: finalLevel,
    changeType: result.change_type,
    reason,
    workflowMode: isSpecFirst ? 'spec-first' : 'single-pr',
    implementationReview: isSpecFirst ? 'ai+human' : 'ai',
    assessment: result
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
  const eff = readEffectiveLevel(repoRoot, changeId);
  return eff ? eff.effectiveLevel : null;
}

export function readEffectiveLevel(repoRoot, changeId) {
  if (!repoRoot || !changeId) return null;
  const cdir = changeDir(repoRoot, changeId);
  const metaPath = path.join(cdir, '.openspec.yaml');
  let declaredLevel = null;
  if (exists(metaPath)) {
    const metaText = readText(metaPath);
    const m = metaText.match(/^\s*level:\s*['"]?([^\s'"]+)['"]?\s*$/m);
    declaredLevel = m ? m[1].toUpperCase() : null;
  }

  const maxHistory = loadMaxHistoryLevel(repoRoot, changeId);
  if (!declaredLevel && !maxHistory) {
    return null;
  }

  const declaredRank = declaredLevel ? (LEVEL_RANK[declaredLevel] ?? 0) : 0;
  const historyRank = maxHistory ? (LEVEL_RANK[maxHistory] ?? 0) : 0;

  const tampered = Boolean(maxHistory && declaredLevel && declaredRank < historyRank);
  const effectiveRank = Math.max(declaredRank, historyRank);
  const effectiveLevel = Object.keys(LEVEL_RANK).find((k) => LEVEL_RANK[k] === effectiveRank) || (declaredLevel || maxHistory || 'L1');

  return {
    declaredLevel,
    maxHistoryLevel: maxHistory,
    effectiveLevel,
    tampered
  };
}

