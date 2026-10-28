import { LEVEL_RANK, CANONICAL_DESTRUCTIVE_PATTERN } from '../rules/builtin.js';
import { judgeChangeSemantics } from '../ai_judge.js';

export function evaluateV1Intent({ requirement = '', specDelta = '', changedFiles = [], changeType = null } = {}) {
  const req = String(requirement || '').toLowerCase();
  const evidence = [];
  const unresolved = [];
  let level = 'L1';
  let confidence = 'high';
  let mandatory_human_review = false;
  let no_signal = false;

  // Infer Change Type if not provided
  let inferredType = changeType;
  if (!inferredType) {
    if (/\b(doc|docs|readme|typo|format|clean|ci|workflow|action|hook|dependency|upgrade|refactor)\b/i.test(req)) {
      inferredType = 'chore';
    } else if (/\b(fix|bug|defect|issue|error|patch|resolve)\b/i.test(req)) {
      inferredType = 'fix';
    } else if (/\b(add|new|feature|capability|create)\b/i.test(req)) {
      inferredType = 'feature';
    } else {
      inferredType = 'change';
    }
  }

  // 1. Destructive Operations & Irreversibility (P0-1)
  if (CANONICAL_DESTRUCTIVE_PATTERN.test(req)) {
    level = 'L3';
    mandatory_human_review = true;
    evidence.push({
      id: 'V1_DESTRUCTIVE_INTENT',
      kind: 'task_statement',
      signal: 'hard',
      summary: 'Task intent indicates irreversible data destruction or purge'
    });
  }

  // 2. AI Semantic Classification: Pure Test or Pure Doc Evaluation (L0)
  // CRITICAL: A soft classifier must NEVER downgrade an already-triggered hard security signal! (P0-1)
  if (!mandatory_human_review) {
    const aiJudgment = judgeChangeSemantics({ requirement: req, changedFiles });
    if (aiJudgment.is_pure_test) {
      level = 'L0';
      inferredType = 'chore';
      evidence.push({
        id: 'V1_AI_TEST_EVALUATION',
        kind: 'scanner_result',
        signal: 'soft',
        summary: aiJudgment.rationale || 'AI Semantic Evaluation: Change is strictly test suites/mocks (evaluated as L0 trivial/routine)'
      });
    } else if (aiJudgment.is_pure_doc) {
      level = 'L0';
      inferredType = 'chore';
      evidence.push({
        id: 'V1_AI_DOC_EVALUATION',
        kind: 'scanner_result',
        signal: 'soft',
        summary: aiJudgment.rationale || 'AI Semantic Evaluation: Intent is purely documentation, typo, or comment editing'
      });
    }
  }

  // If empty input
  if (!req.trim() && changedFiles.length === 0) {
    no_signal = true;
    confidence = 'low';
    unresolved.push('Requirement text is empty or missing');
  }

  return {
    level,
    confidence,
    inferredType,
    evidence,
    unresolved,
    mandatory_human_review,
    no_signal
  };
}
