import { LEVEL_RANK } from '../rules/builtin.js';

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

  // 1. Destructive Operations & Irreversibility
  if (/\b(drop|truncate|purge|hard delete|clean db)\b/i.test(req)) {
    level = 'L3';
    mandatory_human_review = true;
    evidence.push({
      id: 'V1_DESTRUCTIVE_INTENT',
      kind: 'task_statement',
      signal: 'hard',
      summary: 'Task intent indicates irreversible data destruction or purge'
    });
  }

  // 2. Pure Documentation Demotion Check
  if (inferredType === 'chore' && /\b(typo|readme|doc|documentation|comment|whitespace)\b/i.test(req)) {
    if (!/\b(implement|fix bug|create|delete|execute|migrate)\b/i.test(req)) {
      level = 'L0';
      evidence.push({
        id: 'V1_DOC_INTENT',
        kind: 'task_statement',
        signal: 'soft',
        summary: 'Intent is purely documentation, typo, or comment editing'
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
