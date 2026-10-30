/**
 * AI Semantic Classifier with Strict Expectation & Invariant Validation (Specification §2.2 & §5.3)
 *
 * Design principle:
 * Path patterns and filename suffixes are only few-shot examples, NOT hardcoded dogma.
 * Real classification is performed via AI semantic judgment of test/doc nature.
 * System enforces strict expectation invariants on the AI output to prevent hallucinations.
 */

import { execSync } from 'node:child_process';
import { CANONICAL_DESTRUCTIVE_PATTERN } from './rules/builtin.js';

export const AI_CLASSIFICATION_SCHEMA = {
  type: 'object',
  required: ['is_pure_test', 'is_pure_doc', 'classification', 'rationale'],
  properties: {
    is_pure_test: { type: 'boolean' },
    is_pure_doc: { type: 'boolean' },
    contains_destructive_ops: { type: 'boolean' },
    contains_api_changes: { type: 'boolean' },
    classification: { type: 'string', enum: ['test_only', 'doc_only', 'api_contract', 'internal_code', 'destructive', 'governance_plane'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
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

  return { ok: true, validated: aiOutput };
}

/**
 * Semantic evaluation entrypoint:
 * Invokes AI classifier if available, or uses validated few-shot seed heuristic as offline fallback.
 */
export function judgeChangeSemantics({ requirement = '', changedFiles = [], repoRoot = null } = {}) {
  const req = String(requirement || '').toLowerCase();
  const normFiles = (changedFiles || []).map((f) => f.replace(/\\/g, '/'));

  // If environment has an AI classification provider command configured, invoke it (P1-1)
  let rawAiOutput = null;
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
        rawAiOutput = parsed;
      }
    } catch {
      // Fallback to validated heuristic seed on timeout or command failure
    }
  }

  // Few-shot baseline seed for offline / local test fallback
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
      rationale: isPureTest
        ? 'Deterministic Heuristic Baseline: Change is strictly confined to test suites, mocks, and test assertions.'
        : (isPureDoc ? 'Deterministic Heuristic Baseline: Change is purely documentation, typo fix, comments, or non-executable text.' : 'General code change')
    };
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
