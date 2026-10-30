import fs from 'node:fs';
import path from 'node:path';
import { changeDir } from '../lib/paths.js';
import { HARNESS_RULES_VERSION, ENGINE_VERSION } from './rules/builtin.js';
import { evaluateV1Intent } from './vectors/v1_intent.js';
import { evaluateV2Security } from './vectors/v2_security.js';
import { evaluateV3Topology } from './vectors/v3_topology.js';
import { decideAssessment } from './decide.js';
import { deriveGovernance } from './governance.js';
import { appendAssessmentRecord, loadLatestAssessment, loadInitialAssessment } from './store.js';
import { renderCheckSummary, renderPRComment, renderLabels } from './render.js';

export { loadRiskHistory, loadLatestAssessment, loadInitialAssessment, loadMaxHistoryLevel } from './store.js';
export { renderCheckSummary, renderPRComment, renderLabels } from './render.js';
export { HARNESS_RULES_VERSION, ENGINE_VERSION, DEFAULT_GOVERNANCE } from './rules/builtin.js';

/**
 * Unified Risk Assessment Engine (Specification §7.2)
 * The single implementation point for all stages: new, spec, impl.
 */
export function assess({
  stage = 'new',
  changeId,
  baseSha = 'HEAD',
  headSha = null,
  requirement = '',
  changedFiles = [],
  changeType = null,
  previous = null,
  baseline = null,
  actor = { type: 'system', id: 'asdlc' },
  repoRoot = null,
  persist = true
} = {}) {
  try {
    const prev = previous || (repoRoot && changeId ? loadLatestAssessment(repoRoot, changeId) : null);
    const baseRec = baseline || (repoRoot && changeId ? loadInitialAssessment(repoRoot, changeId) : null);

    // If requirement is empty or for spec stage, load proposal.md and design.md from change dir
    let effectiveReq = requirement || '';
    let agentContext = null;
    if (repoRoot && changeId) {
      try {
        const cdir = changeDir(repoRoot, changeId);
        const propPath = path.join(cdir, 'proposal.md');
        if (fs.existsSync(propPath)) {
          const propText = fs.readFileSync(propPath, 'utf8');
          effectiveReq = `${effectiveReq}\n${propText}`.trim();
        }

        // Check if change contains agent assessment context (.agent-assess.json or .openspec.yaml assessment)
        const agentCtxPath = path.join(cdir, '.agent-assess.json');
        if (fs.existsSync(agentCtxPath)) {
          try {
            agentContext = JSON.parse(fs.readFileSync(agentCtxPath, 'utf8'));
          } catch { /* ignore parse error */ }
        }
      } catch { /* ignore read failure */ }
    }

    // 1. Evaluate Three Risk Vectors
    const v1 = evaluateV1Intent({ requirement: effectiveReq, changedFiles, changeType, agentContext });
    const v2 = evaluateV2Security({ requirement: effectiveReq, changedFiles, repoRoot });
    const v3 = evaluateV3Topology({ requirement: effectiveReq, changedFiles, repoRoot, changeId });

    // Inferred or provided Change Type
    const effectiveType = changeType || v1.inferredType || 'change';

    // 2. Decide Level, Verdict, Reason Codes
    const decision = decideAssessment({
      stage,
      v1,
      v2,
      v3,
      changedFiles,
      previous: prev,
      baseline: baseRec
    });

    // 3. Derive Governance Output Matrix
    const governance = decision.governance || deriveGovernance({
      level: decision.level,
      confidence: decision.confidence,
      mandatory_human_review: decision.mandatory_human_review
    });

    const recordData = {
      timestamp: new Date().toISOString(),
      actor,
      stage,
      role: 'primary',
      compared_to: null,
      status: decision.status,
      verdict: decision.verdict,
      defaulted_cause: null,
      change_type: effectiveType,
      source: {
        base_sha: String(baseSha || 'HEAD'),
        head_sha: headSha ? String(headSha) : null,
        harness_rules_version: HARNESS_RULES_VERSION,
        engine_version: ENGINE_VERSION,
        task_ref: null,
        models: []
      },
      risk: {
        level: decision.level,
        confidence: decision.confidence
      },
      vectors: {
        v1_intent: {
          level: v1.level,
          confidence: v1.confidence,
          evidence: v1.evidence,
          unresolved: v1.unresolved,
          mandatory_human_review: v1.mandatory_human_review,
          no_signal: v1.no_signal
        },
        v2_security: {
          level: v2.level,
          confidence: v2.confidence,
          evidence: v2.evidence,
          unresolved: v2.unresolved,
          mandatory_human_review: v2.mandatory_human_review,
          no_signal: v2.no_signal
        },
        v3_topology: {
          level: v3.level,
          confidence: v3.confidence,
          evidence: v3.evidence,
          unresolved: v3.unresolved,
          mandatory_human_review: v3.mandatory_human_review,
          no_signal: v3.no_signal
        }
      },
      governance,
      reason_codes: decision.reason_codes,
      observations: [],
      transition: decision.transition
    };

    // 4. Persist if repoRoot and changeId provided
    if (persist && repoRoot && changeId) {
      return appendAssessmentRecord(repoRoot, changeId, recordData);
    }

    return recordData;
  } catch (err) {
    // Fallback to Global Default on unexpected exception (§5.5)
    const fallbackDecision = decideAssessment({ stage, error: err, previous });
    const fallbackRecord = {
      timestamp: new Date().toISOString(),
      actor,
      stage,
      role: 'primary',
      compared_to: null,
      status: 'defaulted',
      verdict: 'defaulted',
      defaulted_cause: err.message,
      change_type: changeType || 'change',
      source: {
        base_sha: String(baseSha || 'HEAD'),
        head_sha: headSha ? String(headSha) : null,
        harness_rules_version: HARNESS_RULES_VERSION,
        engine_version: ENGINE_VERSION,
        task_ref: null,
        models: []
      },
      risk: {
        level: fallbackDecision.level,
        confidence: 'low'
      },
      vectors: {
        v1_intent: { level: 'L2', confidence: 'low', evidence: [], unresolved: [err.message], mandatory_human_review: true, no_signal: false },
        v2_security: { level: 'L2', confidence: 'low', evidence: [], unresolved: [err.message], mandatory_human_review: true, no_signal: false },
        v3_topology: { level: 'L2', confidence: 'low', evidence: [], unresolved: [err.message], mandatory_human_review: true, no_signal: false }
      },
      governance: fallbackDecision.governance,
      reason_codes: ['DEFAULTED'],
      observations: [],
      transition: fallbackDecision.transition
    };

    if (persist && repoRoot && changeId) {
      try {
        return appendAssessmentRecord(repoRoot, changeId, fallbackRecord);
      } catch {
        // Return memory record if disk append fails
      }
    }
    return fallbackRecord;
  }
}
