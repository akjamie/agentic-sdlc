import { assess } from '../assess/index.js';
import { RISK_LEVELS, LEVEL_RANK } from '../assess/rules/builtin.js';

export { RISK_LEVELS, LEVEL_RANK };

/**
 * Backward-compatible adapter for legacy callers/tests, delegating to unified assess engine.
 */
export function assessRisk({ requirement = '', changedFiles = [], currentLevel = null, repoRoot = null } = {}) {
  const result = assess({
    stage: changedFiles.length > 0 ? 'impl' : 'new',
    requirement,
    changedFiles,
    previous: currentLevel ? { risk: { level: currentLevel } } : null,
    baseline: currentLevel ? { risk: { level: currentLevel } } : null,
    repoRoot,
    persist: false
  });

  const level = result.risk.level;
  const curRank = currentLevel ? (LEVEL_RANK[currentLevel] ?? 1) : null;
  const assessedRank = LEVEL_RANK[level] ?? 1;

  let action = 'INITIAL';
  let escalated = false;
  if (curRank !== null) {
    if (assessedRank > curRank) {
      action = 'ESCALATE';
      escalated = true;
    } else {
      action = 'MAINTAIN';
    }
  }

  return {
    level,
    currentLevel: currentLevel || null,
    action,
    escalated,
    reasons: result.reason_codes || [],
    findings: {
      regulatory: [],
      architectural: [],
      destructive: [],
      demotionGuards: []
    },
    isSinglePr: level === 'L0' || level === 'L1',
    requiresHumanReview: result.governance.implementation_review === 'ai+human' || level === 'L3'
  };
}
