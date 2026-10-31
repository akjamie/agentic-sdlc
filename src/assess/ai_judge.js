/**
 * Agent-Native Semantic Evaluation with Strict Expectation & Invariant Validation (Specification §2.2 & §5.3)
 *
 * Design principle:
 * Classification is performed natively by the executing AI Agent within its live reasoning session,
 * supplemented by environment hooks and validated baseline heuristics.
 * The system enforces strict expectation invariants on the semantic output to prevent hallucinations.
 */

import { execSync } from 'node:child_process';
import { CANONICAL_DESTRUCTIVE_PATTERN, isTestOrDocFile, isChangeMetadataFile } from './rules/builtin.js';

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
  // Exclude per-change SDLC metadata artifacts (openspec/changes/<id>/*) which accompany every branch
  const substantiveFiles = normFiles.filter((f) => !isChangeMetadataFile(f));
  const touchesProductionCode = substantiveFiles.some((f) => !isTestOrDocFile(f));
  if (touchesProductionCode && (aiOutput.is_pure_test || aiOutput.is_pure_doc)) {
    return {
      ok: false,
      error: 'Invariant violation: changes touching production source files cannot be classified as pure test or doc',
      override: { is_pure_test: false, is_pure_doc: false, classification: 'internal_code' }
    };
  }

  // Invariant 4 (Escalate-Only Ratchet): When no substantive files exist yet (stage new / spec),
  // author-agent self-assessment CANNOT claim pure_doc / pure_test unless the requirement text
  // itself deterministically indicates test or documentation work without code/API/security intent.
  if (substantiveFiles.length === 0 && reqLower.trim() && (aiOutput.is_pure_test || aiOutput.is_pure_doc)) {
    const hasDocSignal = /(?:\b(?:docs?|documentation|readme|typo|typos|comments?|whitespace|changelog|markdown|license)\b|文档|注释|错别字|说明文档)/i.test(reqLower);
    const hasTestSignal = /(?:\b(?:unit\s+tests?|integration\s+tests?|e2e\s+tests?|test\s+suites?|test\s+cases?|tests?|testing|mocks?|fixtures?)\b|单元测试|集成测试|测试用例)/i.test(reqLower);

    // Substantive code refactoring or implementation cannot be claimed as pure doc (e.g. "重构订单状态机并补充注释" is code, not doc)
    const hasCodeRefactorOrMutation = /(?:\b(?:refactor|rewrite|redesign|state\s+machine)\b|重构|重写|状态机)/i.test(reqLower) ||
      /\b(?:implement|build|create)\b.*\b(?:api|endpoint|service|controller|router|table|database|schema|handler)\b/i.test(reqLower) ||
      /(?:实现|开发|创建|新增)\b.*(?:接口|服务|路由|数据表|表结构|控制器)/i.test(reqLower) ||
      CANONICAL_DESTRUCTIVE_PATTERN.test(reqLower);

    const isDocOnlyClaim = aiOutput.is_pure_doc && !aiOutput.is_pure_test;
    const isTestOnlyClaim = aiOutput.is_pure_test && !aiOutput.is_pure_doc;

    // A doc claim is invalid if it has no doc signal, or if it contains substantive code refactoring/mutation
    if (isDocOnlyClaim && (!hasDocSignal || hasCodeRefactorOrMutation)) {
      return {
        ok: false,
        error: 'Invariant violation: agent assessment cannot downgrade code/architecture requirement to L0 doc_only',
        override: { is_pure_test: false, is_pure_doc: false, classification: 'internal_code' }
      };
    }

    // A test claim is invalid if it has no test signal, or if it contains destructive operations or code refactoring
    if (isTestOnlyClaim && (!hasTestSignal || CANONICAL_DESTRUCTIVE_PATTERN.test(reqLower) || /(?:\b(?:refactor|rewrite|redesign)\b|重构|重写)/i.test(reqLower))) {
      return {
        ok: false,
        error: 'Invariant violation: agent assessment cannot downgrade destructive or refactoring requirement to L0 test_only',
        override: { is_pure_test: false, is_pure_doc: false, classification: 'internal_code' }
      };
    }
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
    const hasProductionTarget = /\b(create|add|implement|build)\b.*\b(api|endpoint|service|table|database|schema|handler|router)\b/i.test(req) ||
      /(?:创建|新增|实现|开发)\b.*(?:接口|服务|路由|数据表|表结构|控制器)/i.test(req);
    const hasDestructiveAction = CANONICAL_DESTRUCTIVE_PATTERN.test(req);

    const isDocIntent = /(?:\b(?:typo|typos|readme|docs?|documentation|comments?|whitespace|markdown|license|changelog)\b|错别字|文档|注释|说明文档)/i.test(req) &&
      !hasProductionTarget && !hasDestructiveAction;

    const isTestIntent = /(?:\b(?:tests?|testing|mocks?|fixtures?|suites?|unittests?|integrationtests?)\b|单元测试|集成测试|测试用例)/i.test(req) &&
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

    const substantiveFiles = normFiles.filter((f) => !isChangeMetadataFile(f));
    const allTestFiles = substantiveFiles.length > 0 && substantiveFiles.every((f) => testPatternSamples.some((p) => p.test(f)));
    const allDocFiles = substantiveFiles.length > 0 && substantiveFiles.every((f) => docPatternSamples.some((p) => p.test(f)));

    const isPureTest = allTestFiles || (substantiveFiles.length === 0 && isTestIntent);
    const isPureDoc = allDocFiles || (substantiveFiles.length === 0 && isDocIntent);

    rawAiOutput = {
      is_pure_test: isPureTest,
      is_pure_doc: isPureDoc,
      contains_destructive_ops: CANONICAL_DESTRUCTIVE_PATTERN.test(req),
      contains_api_changes: false,
      classification: isPureTest ? 'test_only' : (isPureDoc ? 'doc_only' : 'internal_code'),
      confidence: 'high',
      evaluator_mode: 'heuristic_seed',
      rationale: isPureTest
        ? 'Deterministic Heuristic Baseline: Change is strictly confined to test suites, mocks, and test assertions.'
        : (isPureDoc ? 'Deterministic Heuristic Baseline: Change is purely documentation, typo fix, comments, or non-executable text.' : 'Deterministic Heuristic Baseline: General code change')
    };
  } else {
    rawAiOutput.evaluator_mode = rawAiOutput.evaluator_mode || 'llm_classifier';
  }

  // Mandatory expectation check
  const check = validateAIClassificationExpectation(rawAiOutput, { changedFiles, requirement });
  if (!check.ok) {
    const mode = rawAiOutput?.evaluator_mode || 'heuristic_seed';
    if (check.override) {
      return { ...rawAiOutput, ...check.override, evaluator_mode: mode, confidence: 'medium', invariant_override: true, rejection_reason: check.error };
    }
    return {
      is_pure_test: false,
      is_pure_doc: false,
      classification: 'internal_code',
      confidence: 'low',
      evaluator_mode: mode,
      rationale: `AI output failed expectation verification: ${check.error}`
    };
  }

  return check.validated;
}
