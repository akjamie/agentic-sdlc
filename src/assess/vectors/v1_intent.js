import { LEVEL_RANK, CANONICAL_DESTRUCTIVE_PATTERN } from '../rules/builtin.js';
import { judgeChangeSemantics } from '../ai_judge.js';

export function evaluateV1Intent({ requirement = '', specDelta = '', changedFiles = [], changeType = null, agentContext = null } = {}) {
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

  // 2. Semantic Evaluation: Agent Native Evaluation, External LLM Classifier, or Heuristic Baseline
  const aiJudgment = judgeChangeSemantics({ requirement: req, changedFiles, agentContext });
  const evalMode = aiJudgment.evaluator_mode || 'heuristic_seed';
  const isAiMode = evalMode !== 'heuristic_seed';

  // 2a. Agent / LLM Semantic Escalation (Bidirectional — never triggered by offline regex heuristic_seed):
  if (isAiMode) {
    if (aiJudgment.classification === 'api_contract' || aiJudgment.contains_api_changes) {
      if (level === 'L1') {
        level = 'L2';
        inferredType = inferredType === 'chore' ? 'change' : inferredType;
        evidence.push({
          id: 'V1_AI_API_CONTRACT_INTENT',
          kind: 'semantic_intent',
          signal: 'hard',
          summary: aiJudgment.rationale || 'Agent Semantic Evaluation: Change modifies cross-boundary API contracts'
        });
      }
    } else if (aiJudgment.classification === 'destructive' || aiJudgment.contains_destructive_ops) {
      level = 'L3';
      mandatory_human_review = true;
      evidence.push({
        id: 'V1_AI_DESTRUCTIVE_INTENT',
        kind: 'semantic_intent',
        signal: 'hard',
        summary: aiJudgment.rationale || 'Agent Semantic Evaluation: Task involves destructive data purge or drop'
      });
    } else if (aiJudgment.classification === 'governance_plane') {
      level = 'L3';
      mandatory_human_review = true;
      evidence.push({
        id: 'V1_AI_GOVERNANCE_INTENT',
        kind: 'semantic_intent',
        signal: 'hard',
        summary: aiJudgment.rationale || 'Agent Semantic Evaluation: Task modifies core repository governance'
      });
    }
  }

  // 2b. L0 Trivial Evaluation (only if no hard signals triggered)
  if (!mandatory_human_review && level === 'L1') {
    const modePrefix = isAiMode ? 'Agent Semantic Evaluation' : 'Deterministic Heuristic Baseline';
    if (aiJudgment.is_pure_test) {
      level = 'L0';
      inferredType = 'chore';
      evidence.push({
        id: 'V1_AI_TEST_EVALUATION',
        kind: 'scanner_result',
        signal: 'soft',
        summary: aiJudgment.rationale || `${modePrefix}: Change is strictly test suites/mocks (evaluated as L0 trivial/routine)`
      });
    } else if (aiJudgment.is_pure_doc) {
      level = 'L0';
      inferredType = 'chore';
      evidence.push({
        id: 'V1_AI_DOC_EVALUATION',
        kind: 'scanner_result',
        signal: 'soft',
        summary: aiJudgment.rationale || `${modePrefix}: Intent is purely documentation, typo, or comment editing`
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
    evaluator_mode: evalMode,
    inferredType,
    evidence,
    unresolved,
    mandatory_human_review,
    no_signal,
    requirement: effectiveReqSafe(req),
    aiJudgment
  };
}

function effectiveReqSafe(req) {
  return req || '';
}
