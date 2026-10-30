import { LEVEL_RANK, DEFAULT_GOVERNANCE, L0_DETERMINISTIC_PATTERNS } from './rules/builtin.js';
import { judgeChangeSemantics } from './ai_judge.js';

/**
 * Decides final risk level, confidence, and verdict from vector findings.
 */
export function decideAssessment({
  stage,
  v1,
  v2,
  v3,
  changedFiles = [],
  previous = null,
  baseline = null,
  error = null
} = {}) {
  // 1. Exception / Crash Fallback to Global Default (§5.5)
  if (error) {
    const prevLvl = previous?.risk?.level || baseline?.risk?.level || null;
    const fallbackLevel = prevLvl && (LEVEL_RANK[prevLvl] ?? 1) > (LEVEL_RANK[DEFAULT_GOVERNANCE.level] ?? 1)
      ? prevLvl
      : DEFAULT_GOVERNANCE.level;
    return {
      level: fallbackLevel,
      confidence: 'low',
      status: 'defaulted',
      verdict: 'defaulted',
      defaulted_cause: typeof error === 'string' ? error : error.message || 'Assessment error',
      governance: { ...DEFAULT_GOVERNANCE, level: fallbackLevel },
      reason_codes: ['DEFAULTED'],
      transition: {
        from_level: prevLvl,
        to_level: fallbackLevel,
        direction: prevLvl ? ((LEVEL_RANK[fallbackLevel] ?? 1) > (LEVEL_RANK[prevLvl] ?? 1) ? 'up' : 'same') : 'initial',
        triggers: ['Assessment crashed or failed, fallen back to safe global defaults']
      }
    };
  }

  // 2. Rank calculation: max(V1, V2, V3)
  const vectorLevels = [v1.level, v2.level, v3.level];
  let calculatedLevel = 'L1';
  let maxRank = 1;

  for (const lvl of vectorLevels) {
    const r = LEVEL_RANK[lvl] ?? 1;
    if (r > maxRank) {
      maxRank = r;
      calculatedLevel = lvl;
    }
  }

  // 3. Positive Proof for L0 (§2.2):
  // Pure Documentation or Pure Test changes evaluated by AI Semantic Judge
  const hasMandatoryHumanReview = Boolean(
    v1.mandatory_human_review || v2.mandatory_human_review || v3.mandatory_human_review
  );

  const req = v1.requirement || '';
  const aiJudgment = v1.aiJudgment || judgeChangeSemantics({ requirement: req, changedFiles });

  if (!hasMandatoryHumanReview && maxRank <= 1) {
    if (changedFiles.length > 0) {
      const norm = changedFiles.map((f) => f.replace(/\\/g, '/'));
      const allDoc = norm.every((f) => L0_DETERMINISTIC_PATTERNS.some((p) => p.test(f)));
      if (allDoc || aiJudgment.is_pure_doc || aiJudgment.is_pure_test) {
        calculatedLevel = 'L0';
      }
    } else if (aiJudgment.is_pure_test || aiJudgment.is_pure_doc || (v1.level === 'L0' && v2.no_signal && v3.no_signal)) {
      calculatedLevel = 'L0';
    }
  }

  // 4. Determine Confidence & Unresolved
  const allUnresolved = [
    ...(v1.unresolved || []),
    ...(v2.unresolved || []),
    ...(v3.unresolved || [])
  ];

  let confidence = 'high';
  if (v1.confidence === 'low' || v2.confidence === 'low' || v3.confidence === 'low') {
    confidence = 'low';
  } else if (v1.confidence === 'medium' || v2.confidence === 'medium' || v3.confidence === 'medium') {
    confidence = 'medium';
  }

  // 5. Monotonic Escalation (§5.1 & §9.1): Auto recalculation only goes UP
  let finalLevel = calculatedLevel;
  let direction = 'initial';
  let triggers = [];
  const reason_codes = [];

  const prevLevel = previous?.risk?.level || null;
  const baselineLevel = baseline?.risk?.level || previous?.risk?.level || null;

  if (prevLevel || baselineLevel) {
    const prevRank = prevLevel ? (LEVEL_RANK[prevLevel] ?? 1) : 1;
    const baseRank = baselineLevel ? (LEVEL_RANK[baselineLevel] ?? 1) : 1;
    const curRank = LEVEL_RANK[finalLevel] ?? 1;

    // Highest reached rank in history
    const highestRank = Math.max(curRank, prevRank, baseRank);
    finalLevel = Object.keys(LEVEL_RANK).find((k) => LEVEL_RANK[k] === highestRank) || finalLevel;

    if (curRank > prevRank) {
      direction = 'up';
      triggers.push(`Level escalated from ${prevLevel} to ${finalLevel}`);
      if (stage === 'impl') {
        reason_codes.push('ESCALATED_IN_IMPL');
      } else {
        reason_codes.push('SOFT_SIGNAL_ESCALATION');
      }
    } else if (highestRank > baseRank) {
      direction = 'same';
      triggers.push(`Level remains escalated at ${finalLevel} above baseline ${baselineLevel}`);
      if (stage === 'impl') {
        reason_codes.push('ESCALATED_IN_IMPL');
      }
    } else {
      direction = 'same';
    }
  }

  // Collect Reason Codes
  const hasHardRule = [...(v1.evidence || []), ...(v2.evidence || []), ...(v3.evidence || [])]
    .some((e) => e.signal === 'hard');
  if (hasHardRule) {
    reason_codes.push('HARD_RULE_HIT');
  }

  if (finalLevel === 'L3') {
    reason_codes.push('SECURITY_BOUNDARY_POSSIBLE');
  }

  const mandatoryHuman = Boolean(v1.mandatory_human_review || v2.mandatory_human_review || v3.mandatory_human_review);

  // Determine Verdict
  let verdict = 'ok';
  let status = stage === 'new' ? 'provisional' : 'ready';

  const baseRank = baselineLevel ? (LEVEL_RANK[baselineLevel] ?? 1) : null;
  const finalRank = LEVEL_RANK[finalLevel] ?? 1;

  if (direction === 'up' || (baseRank !== null && finalRank > baseRank)) {
    verdict = 'escalated';
  }

  return {
    level: finalLevel,
    confidence,
    status,
    verdict,
    reason_codes: [...new Set(reason_codes)],
    mandatory_human_review: mandatoryHuman,
    unresolved: allUnresolved,
    transition: {
      from_level: prevLevel,
      to_level: finalLevel,
      direction,
      triggers
    }
  };
}
