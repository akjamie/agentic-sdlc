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

test('assess: P0-1 regression - hard delete intent with unit test keyword cannot be downgraded to L0', () => {
  const rec = assess({
    stage: 'new',
    changeId: 'unit-test-hard-delete',
    requirement: 'add unit tests for the hard delete script',
    persist: false
  });
  assert.equal(rec.risk.level, 'L3', 'Destructive intent must remain L3 even if test keyword is present');
  assert.equal(rec.governance.implementation_review, 'ai+human');
  assert.equal(rec.governance.auto_approval, 'disabled');
});

test('assess: P0-2 regression - agent skill modifications trigger HARD_GOV_PLANE (L3) and never classify as L0', () => {
  const rec1 = assess({
    stage: 'impl',
    changeId: 'skill-tamper-1',
    changedFiles: ['assets/skills/asdlc-apply/SKILL.md'],
    persist: false
  });
  assert.equal(rec1.risk.level, 'L3');
  assert.equal(rec1.governance.implementation_review, 'ai+human');

  const rec2 = assess({
    stage: 'impl',
    changeId: 'skill-tamper-2',
    changedFiles: ['.agents/skills/asdlc-new/SKILL.md'],
    persist: false
  });
  assert.equal(rec2.risk.level, 'L3');
  assert.equal(rec2.governance.implementation_review, 'ai+human');
});

test('assess: P1-2 regression - innocuous SQL filename containing destructive DDL is detected via content', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-sql-content-test-'));
  try {
    fs.mkdirSync(path.join(tmp, 'migrations'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'migrations', '009_cleanup.sql'), '-- innocuous comment\nDROP TABLE accounts;\n');

    const rec = assess({
      stage: 'impl',
      changeId: 'sql-content-test',
      changedFiles: ['migrations/009_cleanup.sql'],
      repoRoot: tmp,
      persist: false
    });
    assert.equal(rec.risk.level, 'L3', 'SQL content with DROP TABLE must trigger L3 regardless of filename');
    assert.equal(rec.governance.implementation_review, 'ai+human');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('assess: P1-3 regression - tampered risk-history.jsonl fails closed on read', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-tamper-read-test-'));
  try {
    const changeId = 'tamper-flow';
    const cdir = path.join(tmp, 'openspec', 'changes', changeId);
    fs.mkdirSync(cdir, { recursive: true });

    // Create valid assessment
    assess({
      stage: 'new',
      changeId,
      requirement: 'implement secure ledger',
      repoRoot: tmp
    });

    // Verify valid load
    const hist = loadRiskHistory(tmp, changeId);
    assert.equal(hist.length, 1);

    // Tamper with file
    const histPath = path.join(cdir, 'risk-history.jsonl');
    const original = fs.readFileSync(histPath, 'utf8');
    const tampered = original.replace('"L2"', '"L0"');
    assert.notEqual(original, tampered, 'Must replace level to tamper');
    fs.writeFileSync(histPath, tampered);

    assert.throws(
      () => loadRiskHistory(tmp, changeId),
      (err) => err.code === 'TAMPER_DETECTED' || err.message.includes('tamper')
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

