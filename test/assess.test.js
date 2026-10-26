import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { assess, loadRiskHistory, loadLatestAssessment, renderCheckSummary, renderPRComment, renderLabels } from '../src/assess/index.js';
import { computeRecordHash, validateRecordSchema, validateChainInvariants } from '../src/assess/schema.js';

test('assess: stage new initial evaluation and hash chain generation', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-assess-test-'));
  try {
    const changeId = 'auth-session';
    const cdir = path.join(tmp, 'openspec', 'changes', changeId);
    fs.mkdirSync(cdir, { recursive: true });

    // 1. Initial evaluation
    const rec1 = assess({
      stage: 'new',
      changeId,
      requirement: 'implement jwt token session authentication',
      repoRoot: tmp
    });

    assert.equal(rec1.seq, 1);
    assert.equal(rec1.prev_hash, null);
    assert.ok(rec1.hash);
    assert.equal(rec1.risk.level, 'L3');
    assert.equal(rec1.governance.workflow_mode, 'spec-first');
    assert.equal(rec1.governance.implementation_review, 'ai+human');
    assert.equal(rec1.transition.direction, 'initial');

    // Verify hash integrity
    assert.equal(computeRecordHash(rec1), rec1.hash);

    // 2. Second evaluation (Spec stage)
    const rec2 = assess({
      stage: 'spec',
      changeId,
      requirement: 'implement jwt token session authentication',
      repoRoot: tmp
    });

    assert.equal(rec2.seq, 2);
    assert.equal(rec2.prev_hash, rec1.hash);
    assert.equal(rec2.risk.level, 'L3');

    // Check disk files
    const history = loadRiskHistory(tmp, changeId);
    assert.equal(history.length, 2);
    assert.equal(history[0].hash, rec1.hash);
    assert.equal(history[1].hash, rec2.hash);

    const latest = loadLatestAssessment(tmp, changeId);
    assert.equal(latest.hash, rec2.hash);

    // Verify chain invariant
    const chainValid = validateChainInvariants(history);
    assert.equal(chainValid.valid, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('assess: enforces monotonic escalation (only goes UP, never down without waiver)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-monotonic-test-'));
  try {
    const changeId = 'monotonic-flow';
    const cdir = path.join(tmp, 'openspec', 'changes', changeId);
    fs.mkdirSync(cdir, { recursive: true });

    // Step 1: new -> L1
    const rec1 = assess({
      stage: 'new',
      changeId,
      requirement: 'refactor internal math helper',
      repoRoot: tmp
    });
    assert.equal(rec1.risk.level, 'L1');
    assert.equal(rec1.governance.workflow_mode, 'single-pr');

    // Step 2: impl -> modified API contract -> Escalates to L2
    const rec2 = assess({
      stage: 'impl',
      changeId,
      changedFiles: ['src/api/routes.js', 'src/math.js'],
      repoRoot: tmp
    });
    assert.equal(rec2.risk.level, 'L2');
    assert.equal(rec2.transition.direction, 'up');
    assert.equal(rec2.verdict, 'escalated');
    assert.equal(rec2.governance.implementation_review, 'ai+human');

    // Step 3: subsequent re-check with only local file -> MUST MAINTAIN L2 (never demote)
    const rec3 = assess({
      stage: 'impl',
      changeId,
      changedFiles: ['src/math.js'],
      repoRoot: tmp
    });
    assert.equal(rec3.risk.level, 'L2');
    assert.equal(rec3.transition.direction, 'same');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('assess: hard signal single-veto for destructive operations and security', () => {
  const r1 = assess({
    stage: 'impl',
    changeId: 'drop-test',
    changedFiles: ['migrations/002_drop_users_table.sql'],
    persist: false
  });
  assert.equal(r1.risk.level, 'L3');
  assert.equal(r1.governance.implementation_review, 'ai+human');
  assert.equal(r1.governance.spec_approval, 'human');

  const r2 = assess({
    stage: 'impl',
    changeId: 'doc-test',
    changedFiles: ['docs/guide.md', 'README.md'],
    persist: false
  });
  assert.equal(r2.risk.level, 'L0');
  assert.equal(r2.governance.workflow_mode, 'single-pr');
  assert.equal(r2.governance.implementation_review, 'ai');
});

test('assess: fallback to global defaults on crash (§5.5)', () => {
  const fallback = assess({
    stage: 'impl',
    changeId: 'crash-change',
    // passing an invalid object structure to force internal handling
    requirement: null,
    changedFiles: null,
    persist: false
  });

  assert.ok(['L2', 'L3'].includes(fallback.risk.level));
  assert.equal(fallback.governance.workflow_mode, 'spec-first');
  assert.equal(fallback.governance.implementation_review, 'ai+human');
});

test('render: formats check summary, PR comment, and labels correctly', () => {
  const mockRecord = {
    change_id: 'sample',
    seq: 2,
    hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    stage: 'impl',
    verdict: 'escalated',
    risk: { level: 'L2', confidence: 'high' },
    governance: { workflow_mode: 'spec-first', implementation_review: 'ai+human' },
    reason_codes: ['HARD_RULE_HIT', 'ESCALATED_IN_IMPL'],
    source: { harness_rules_version: '2026.10.0' },
    vectors: {
      v1_intent: { evidence: [] },
      v2_security: { evidence: [] },
      v3_topology: { evidence: [{ signal: 'hard', summary: 'API routes modified' }] }
    },
    transition: { direction: 'up', from_level: 'L1', to_level: 'L2' }
  };

  const summary = renderCheckSummary(mockRecord);
  assert.match(summary, /\[ESCALATED\]/);
  assert.match(summary, /Level: L2/);
  assert.match(summary, /human-review-required/);

  const comment = renderPRComment(mockRecord);
  assert.match(comment, /需要人工评审 · 风险等级 L1 → L2（升级）/);
  assert.match(comment, /API routes modified/);
  assert.match(comment, /spec-first/);

  const labels = renderLabels(mockRecord);
  assert.deepEqual(labels, ['asdlc:L2', 'asdlc:human-review-required', 'asdlc:escalated']);
});
