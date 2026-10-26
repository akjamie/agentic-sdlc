import path from 'node:path';
import { exists, readText } from './fs.js';
import { changeDir } from './paths.js';
import { assess, loadLatestAssessment } from '../assess/index.js';
import { RISK_LEVELS } from '../assess/rules/builtin.js';

export const LEVELS = RISK_LEVELS;

export function inferInitialLevel({ requirement = '', explicitLevel, repoRoot, changeId } = {}) {
  if (explicitLevel) {
    const norm = String(explicitLevel).toUpperCase();
    if (LEVELS[norm]) {
      return {
        level: norm,
        changeType: 'change',
        reason: `explicitly specified via --level ${norm}`,
        workflowMode: norm === 'L0' || norm === 'L1' ? 'single-pr' : 'spec-first',
        implementationReview: norm === 'L3' ? 'ai+human' : 'ai',
        assessment: null
      };
    }
  }

  const result = assess({
    stage: 'new',
    changeId: changeId || 'provisional',
    requirement,
    repoRoot,
    persist: Boolean(repoRoot && changeId)
  });

  // Extract the most descriptive reason
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

  return {
    level: result.risk.level,
    changeType: result.change_type,
    reason,
    workflowMode: result.governance.workflow_mode,
    implementationReview: result.governance.implementation_review,
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
  if (!repoRoot || !changeId) return null;
  const cdir = changeDir(repoRoot, changeId);
  const metaPath = path.join(cdir, '.openspec.yaml');
  if (!exists(metaPath)) return null;
  const metaText = readText(metaPath);
  const m = metaText.match(/^\s*level:\s*['"]?([^\s'"]+)['"]?\s*$/m);
  return m ? m[1].toUpperCase() : null;
}

