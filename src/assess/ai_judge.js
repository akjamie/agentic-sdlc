/**
 * Agent-Native Semantic Evaluation with Strict Expectation & Invariant Validation (Specification §2.2 & §5.3)
 *
 * Design principle:
 * Classification is performed natively by the executing AI Agent within its live reasoning session,
 * supplemented by environment hooks and validated baseline heuristics.
 * The system enforces strict expectation invariants on the semantic output to prevent hallucinations.
 */

import { execSync } from 'node:child_process';
import { CANONICAL_DESTRUCTIVE_PATTERN, isTestOrDocFile } from './rules/builtin.js';

export const AI_CLASSIFICATION_SCHEMA = {
  type: 'object',
  required: ['is_pure_test', 'is_pure_doc', 'classification', 'rationale', 'evaluator_mode'],
  properties: {
    is_pure_test: { type: 'boolean' },
    is_pure_doc: { type: 'boolean' },
    contains_destructive_ops: { type: 'boolean' },
    contains_api_changes: { type: 'boolean' },
    classification: { type: 'string', enum: ['test_only', 'doc_only', 'api_contract', 'internal_code', 'destructive', 'governance_plane'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    evaluator_mode: { type: 'string', enum: ['agent_native', 'llm_classifier', 'heuristic_seed'] },
    rationale: { type: 'string' }
  }
};

/**
 * Validates AI classification against hard security and governance expectations.
 * If AI claims a change is "pure test" or "pure doc", verify it does not violate invariants.
 */
export function validateAIClassificationExpectation(aiOutput, { changedFiles = [], requirement = '' } = {}) {
  if (!aiOutput || typeof aiOutput !== 'object') {
    return { ok: false, error: 'AI output is not a valid JSON object' };
  }

  if (typeof aiOutput.is_pure_test !== 'boolean' || typeof aiOutput.is_pure_doc !== 'boolean') {
    return { ok: false, error: 'AI output missing boolean flags for is_pure_test / is_pure_doc' };
  }

  if (!aiOutput.rationale || typeof aiOutput.rationale !== 'string' || !aiOutput.rationale.trim()) {
    return { ok: false, error: 'AI output missing substantive rationale' };
  }

  const reqLower = String(requirement || '').toLowerCase();
  const normFiles = (changedFiles || []).map((f) => f.replace(/\\/g, '/').toLowerCase());

  // Invariant 1: Core Governance files can NEVER be pure test or pure doc (P0-2)
  const touchesGov = normFiles.some((f) =>
    f.endsWith('agents.md') ||
    f.includes('openspec/config.yaml') ||
    /(?:assets|\.agents)\/skills\/.*skill\.md$/i.test(f)
  );
  if (touchesGov && (aiOutput.is_pure_test || aiOutput.is_pure_doc)) {
    return {
      ok: false,
      error: 'Invariant violation: AGENTS.md, openspec/config.yaml, or agent skills cannot be classified as pure test or doc',
      override: { is_pure_test: false, is_pure_doc: false, classification: 'governance_plane' }
    };
  }

  // Invariant 2: Explicit destructive DDL commands in requirement cannot be pure test or doc (P0-1)
  if (CANONICAL_DESTRUCTIVE_PATTERN.test(reqLower) && (aiOutput.is_pure_test || aiOutput.is_pure_doc)) {
    return {
      ok: false,
      error: 'Invariant violation: destructive data purge requirement cannot be classified as pure test or doc',
      override: { is_pure_test: false, is_pure_doc: false, classification: 'destructive' }
    };
  }

  // Invariant 3: Production source code files cannot be disguised as pure test or doc
  const touchesProductionCode = normFiles.some((f) => !isTestOrDocFile(f));
  if (touchesProductionCode && (aiOutput.is_pure_test || aiOutput.is_pure_doc)) {
    return {
      ok: false,
      error: 'Invariant violation: changes touching production source files cannot be classified as pure test or doc',
      override: { is_pure_test: false, is_pure_doc: false, classification: 'internal_code' }
    };
  }

  return { ok: true, validated: aiOutput };
}

/**
 * Semantic evaluation entrypoint:
 * Grounded in Agent session reasoning, environment model hooks, or validated heuristic baseline.
 */
export function judgeChangeSemantics({ requirement = '', changedFiles = [], repoRoot = null, agentContext = null } = {}) {
  const req = String(requirement || '').toLowerCase();
  const normFiles = (changedFiles || []).map((f) => f.replace(/\\/g, '/'));

  let rawAiOutput = null;

  // 1. Direct Agent-Native Evaluation:
  // When running inside an AI coding agent session, accept verified semantic reasoning from the agent
  if (agentContext && typeof agentContext === 'object') {
    rawAiOutput = {
      is_pure_test: Boolean(agentContext.is_pure_test),
      is_pure_doc: Boolean(agentContext.is_pure_doc),
      contains_destructive_ops: Boolean(agentContext.contains_destructive_ops || CANONICAL_DESTRUCTIVE_PATTERN.test(req)),
      contains_api_changes: Boolean(agentContext.contains_api_changes),
      classification: agentContext.classification || (agentContext.is_pure_test ? 'test_only' : (agentContext.is_pure_doc ? 'doc_only' : 'internal_code')),
      confidence: agentContext.confidence || 'high',
      evaluator_mode: 'agent_native',
      rationale: agentContext.rationale || 'Evaluated natively by executing AI Agent in active session'
    };
  }

  // 2. External Provider Command (if configured via environment hook)
  if (!rawAiOutput) {
    const classifierCmd = process.env.ASDLC_CLASSIFIER_COMMAND;
    if (classifierCmd) {
      try {
        const inputJson = JSON.stringify({ requirement: req, changedFiles: normFiles });
        const stdout = execSync(classifierCmd, {
          input: inputJson,
          encoding: 'utf8',
          timeout: 5000,
          env: { ...process.env, ASDLC_INPUT_JSON: inputJson }
        });
        const parsed = JSON.parse(stdout.trim());
        if (parsed && typeof parsed === 'object') {
          rawAiOutput = { ...parsed, evaluator_mode: 'llm_classifier' };
        }
      } catch {
        // Fallback to baseline heuristic on timeout or execution failure
      }
    }
  }

  // 3. Validated baseline heuristic seed (deterministic fallback for standalone CLI execution)
  if (!rawAiOutput) {
    const hasProductionTarget = /\b(create|add|implement|build)\b.*\b(api|endpoint|service|table|database|schema|handler|router)\b/i.test(req);
    const hasDestructiveAction = CANONICAL_DESTRUCTIVE_PATTERN.test(req);

    const isDocIntent = /\b(typo|readme|docs?|documentation|comments?|whitespace)\b/i.test(req) &&
      !hasProductionTarget && !hasDestructiveAction;

    const isTestIntent = /\b(tests?|testing|mocks?|fixtures?|suites?|unittests?|integrationtests?)\b/i.test(req) &&
      !hasProductionTarget && !hasDestructiveAction;

    // Few-shot file pattern seeds (illustrative samples)
    const testPatternSamples = [
      /(^|\/)(tests?|__tests__|testing|fixtures?|mocks?)\//i,
      /\.(test|spec)\.[a-z0-9]+$/i,
      /_test\.go$/i,
      /test_[^/]+\.py$/i,
      /[^/]+_test\.py$/i
    ];

    const docPatternSamples = [
      /(^|\/)docs?\//i,
      /\.(md|txt)$/i,
      /^license$/i
    ];

    const allTestFiles = normFiles.length > 0 && normFiles.every((f) => testPatternSamples.some((p) => p.test(f)));
    const allDocFiles = normFiles.length > 0 && normFiles.every((f) => docPatternSamples.some((p) => p.test(f)));

    const isPureTest = allTestFiles || (normFiles.length === 0 && isTestIntent);
    const isPureDoc = allDocFiles || (normFiles.length === 0 && isDocIntent);

    rawAiOutput = {
      is_pure_test: isPureTest,
      is_pure_doc: isPureDoc,
      contains_destructive_ops: CANONICAL_DESTRUCTIVE_PATTERN.test(req),
      contains_api_changes: /\b(api|openapi|rest|controller|router)\b/i.test(req),
      classification: isPureTest ? 'test_only' : (isPureDoc ? 'doc_only' : 'internal_code'),
      confidence: 'high',
      evaluator_mode: 'heuristic_seed',
      rationale: isPureTest
        ? 'Deterministic Heuristic Baseline: Change is strictly confined to test suites, mocks, and test assertions.'
        : (isPureDoc ? 'Deterministic Heuristic Baseline: Change is purely documentation, typo fix, comments, or non-executable text.' : 'General code change')
    };
  } else {
    rawAiOutput.evaluator_mode = rawAiOutput.evaluator_mode || 'llm_classifier';
  }

  // Mandatory expectation check
  const check = validateAIClassificationExpectation(rawAiOutput, { changedFiles, requirement });
  if (!check.ok) {
    if (check.override) {
      return { ...rawAiOutput, ...check.override, confidence: 'medium', invariant_override: true, rejection_reason: check.error };
    }
    return {
      is_pure_test: false,
      is_pure_doc: false,
      classification: 'internal_code',
      confidence: 'low',
      rationale: `AI output failed expectation verification: ${check.error}`
    };
  }

  return check.validated;
}
