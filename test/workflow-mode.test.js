import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { deriveGovernance } from '../src/assess/governance.js';
import { resolveWorkflowMode, validateWorkflowMode, saveGlobalConfig, loadGlobalConfig, MODE_RANK } from '../src/lib/config.js';
import { renderPRComment, renderLabels, renderCheckSummary } from '../src/assess/render.js';
import { assess } from '../src/assess/index.js';
import { newChange } from '../src/commands/new.js';
import { applyGuard } from '../src/commands/apply.js';
import { runVerify } from '../src/commands/verify.js';
import { statusChange } from '../src/commands/status.js';
import { git } from '../src/lib/git.js';

test('Workflow Mode: deriveGovernance default is supervised across L0-L3', () => {
  // 1. L0 under default (supervised): Single-PR, ai+human, auto-merge disabled
  const g0 = deriveGovernance({ level: 'L0' });
  assert.equal(g0.workflow_mode, 'single-pr');
  assert.equal(g0.spec_approval, 'not-applicable');
  assert.equal(g0.implementation_review, 'ai+human');
  assert.equal(g0.auto_approval, 'disabled');

  // 2. L1 under default (supervised): Single-PR, automatic spec, ai+human, auto-merge disabled
  const g1 = deriveGovernance({ level: 'L1' });
  assert.equal(g1.workflow_mode, 'single-pr');
  assert.equal(g1.spec_approval, 'automatic');
  assert.equal(g1.implementation_review, 'ai+human');
  assert.equal(g1.auto_approval, 'disabled');

  // 3. L2 under default (supervised): spec-first Dual-PR, human spec, ai+human, auto-merge disabled
  const g2 = deriveGovernance({ level: 'L2' });
  assert.equal(g2.workflow_mode, 'spec-first');
  assert.equal(g2.spec_approval, 'human');
  assert.equal(g2.implementation_review, 'ai+human');
  assert.equal(g2.auto_approval, 'disabled');

  // 4. L3 under default (supervised): spec-first Dual-PR, human spec, ai+human, auto-merge disabled
  const g3 = deriveGovernance({ level: 'L3' });
  assert.equal(g3.workflow_mode, 'spec-first');
  assert.equal(g3.spec_approval, 'human');
  assert.equal(g3.implementation_review, 'ai+human');
  assert.equal(g3.auto_approval, 'disabled');
});

test('Workflow Mode: deriveGovernance under auto mode enables auto-merge for L0/L1', () => {
  const g0 = deriveGovernance({ level: 'L0', mode: 'auto' });
  assert.equal(g0.workflow_mode, 'single-pr');
  assert.equal(g0.spec_approval, 'not-applicable');
  assert.equal(g0.implementation_review, 'ai');
  assert.equal(g0.auto_approval, 'enabled');

  const g1 = deriveGovernance({ level: 'L1', mode: 'auto' });
  assert.equal(g1.workflow_mode, 'single-pr');
  assert.equal(g1.spec_approval, 'automatic');
  assert.equal(g1.implementation_review, 'ai');
  assert.equal(g1.auto_approval, 'enabled');

  const g2 = deriveGovernance({ level: 'L2', mode: 'auto' });
  assert.equal(g2.workflow_mode, 'spec-first');
  assert.equal(g2.spec_approval, 'human');
  assert.equal(g2.implementation_review, 'ai+human');
  assert.equal(g2.auto_approval, 'disabled');

  // Safety override under auto when confidence is low
  const g1Low = deriveGovernance({ level: 'L1', mode: 'auto', confidence: 'low' });
  assert.equal(g1Low.implementation_review, 'ai+human');
  assert.equal(g1Low.auto_approval, 'disabled');
});

test('Workflow Mode: deriveGovernance under spec-first mode enforces Dual-PR for all levels L0-L3', () => {
  for (const lvl of ['L0', 'L1', 'L2', 'L3']) {
    const g = deriveGovernance({ level: lvl, mode: 'spec-first' });
    assert.equal(g.workflow_mode, 'spec-first', `${lvl} must be spec-first`);
    assert.equal(g.spec_approval, 'human', `${lvl} must require human spec approval`);
    assert.equal(g.implementation_review, 'ai+human');
    assert.equal(g.auto_approval, 'disabled');
  }
});

test('Workflow Mode Invariant: single-pr or invalid strings are rejected as configured modes', () => {
  assert.throws(() => {
    deriveGovernance({ level: 'L1', mode: 'single-pr' });
  }, { code: 'INVALID_WORKFLOW_MODE' });

  assert.throws(() => {
    validateWorkflowMode('single-pr');
  }, { code: 'INVALID_WORKFLOW_MODE' });

  assert.throws(() => {
    validateWorkflowMode('unsupported-mode');
  }, { code: 'INVALID_WORKFLOW_MODE' });
});

test('Precedence & Monotonic Tightening: resolveWorkflowMode enforces security floor and overrides', () => {
  // Built-in default is supervised
  const dflt = resolveWorkflowMode();
  assert.equal(dflt, 'supervised');

  // Global config fallback
  const globalOnly = resolveWorkflowMode({ globalConfig: { workflow_mode: 'auto' } });
  assert.equal(globalOnly, 'auto');

  // Repo floor overrides global config
  const repoOverGlobal = resolveWorkflowMode({
    repoPolicy: { workflow_mode: 'supervised' },
    globalConfig: { workflow_mode: 'auto' }
  });
  assert.equal(repoOverGlobal, 'supervised');

  // CLI tightening (supervised -> spec-first) is permitted
  const cliTighten = resolveWorkflowMode({
    cliMode: 'spec-first',
    repoPolicy: { workflow_mode: 'supervised' }
  });
  assert.equal(cliTighten, 'spec-first');

  // CLI downgrade (supervised -> auto) fails closed with ILLEGAL_MODE_DOWNGRADE
  assert.throws(() => {
    resolveWorkflowMode({
      cliMode: 'auto',
      repoPolicy: { workflow_mode: 'supervised' }
    });
  }, { code: 'ILLEGAL_MODE_DOWNGRADE' });

  // Env downgrade (spec-first repo floor -> auto env) fails closed
  assert.throws(() => {
    resolveWorkflowMode({
      envMode: 'auto',
      repoPolicy: { workflow_mode: 'spec-first' }
    });
  }, { code: 'ILLEGAL_MODE_DOWNGRADE' });

  // When repo sets auto, CLI tightening to supervised or spec-first is allowed
  const tightenedFromAuto1 = resolveWorkflowMode({
    cliMode: 'supervised',
    repoPolicy: { workflow_mode: 'auto' }
  });
  assert.equal(tightenedFromAuto1, 'supervised');

  const tightenedFromAuto2 = resolveWorkflowMode({
    cliMode: 'spec-first',
    repoPolicy: { workflow_mode: 'auto' }
  });
  assert.equal(tightenedFromAuto2, 'spec-first');
});

test('Render: PR comment banner renders Supervised Single-PR banner for L0/L1 and high-risk for L2/L3', () => {
  // L1 Supervised
  const recL1Supervised = {
    verdict: 'ok',
    risk: { level: 'L1', confidence: 'high' },
    governance: {
      workflow_mode: 'single-pr',
      spec_approval: 'automatic',
      implementation_review: 'ai+human',
      auto_approval: 'disabled'
    },
    transition: { direction: 'initial', from_level: null },
    reason_codes: ['BOUNDED_LOCAL_CHANGE'],
    vectors: { v1_intent: { evidence: [] }, v2_security: { evidence: [] }, v3_topology: { evidence: [] } }
  };
  const commentL1 = renderPRComment(recL1Supervised);
  assert.match(commentL1, /受控单 PR 模式 \(Supervised\)/);
  assert.doesNotMatch(commentL1, /高风险改动 · 必须人工终审/);
  assert.match(commentL1, /自动合并已关闭 \(Auto-Merge DENIED\)/);

  // L2 High-Risk
  const recL2 = {
    verdict: 'ok',
    risk: { level: 'L2', confidence: 'high' },
    governance: {
      workflow_mode: 'spec-first',
      spec_approval: 'human',
      implementation_review: 'ai+human',
      auto_approval: 'disabled'
    },
    transition: { direction: 'initial', from_level: null },
    reason_codes: ['PUBLIC_API_MODIFICATION'],
    vectors: { v1_intent: { evidence: [] }, v2_security: { evidence: [] }, v3_topology: { evidence: [] } }
  };
  const commentL2 = renderPRComment(recL2);
  assert.match(commentL2, /高风险改动 · 必须人工终审/);

  // L1 Auto (Autonomous)
  const recL1Auto = {
    verdict: 'ok',
    risk: { level: 'L1', confidence: 'high' },
    governance: {
      workflow_mode: 'single-pr',
      spec_approval: 'automatic',
      implementation_review: 'ai',
      auto_approval: 'enabled'
    },
    transition: { direction: 'initial', from_level: null },
    reason_codes: ['BOUNDED_LOCAL_CHANGE'],
    vectors: { v1_intent: { evidence: [] }, v2_security: { evidence: [] }, v3_topology: { evidence: [] } }
  };
  const commentAuto = renderPRComment(recL1Auto);
  assert.match(commentAuto, /低风险改动 · AI 自动合入 \(Auto-Merge Eligible\)/);

  // Labels check
  const labelsSupervised = renderLabels(recL1Supervised);
  assert.deepEqual(labelsSupervised, ['asdlc:L1', 'asdlc:human-review-required']);

  const labelsAuto = renderLabels(recL1Auto);
  assert.deepEqual(labelsAuto, ['asdlc:L1']);
});

test('Integration Lifecycle: Supervised mode allows L1 direct apply while spec-first enforces Dual-PR', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-mode-test-'));
  try {
    // Initialize git repo
    git(['init', '-b', 'main'], tmp);
    git(['config', 'user.name', 'test'], tmp);
    git(['config', 'user.email', 'test@test.com'], tmp);
    fs.mkdirSync(path.join(tmp, 'openspec', 'changes'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'README.md'), '# Test\n');
    git(['add', '.'], tmp);
    git(['commit', '-m', 'initial commit'], tmp);

    // 1. Create a change with default (supervised) mode
    newChange('update documentation in guide', { repoRoot: tmp, id: 'sup-doc', grill: false, openspec: false });
    const cdirSup = path.join(tmp, 'openspec', 'changes', 'sup-doc');
    fs.writeFileSync(path.join(cdirSup, 'proposal.md'), '# Proposal: sup-doc\nDoc change\n');
    fs.writeFileSync(path.join(cdirSup, 'tasks.md'), '## Tasks\n- [ ] task 1\n');
    fs.mkdirSync(path.join(cdirSup, 'specs', 'guide'), { recursive: true });
    fs.writeFileSync(path.join(cdirSup, 'specs', 'guide', 'spec.md'), '## Scenario: doc\n- GIVEN a doc\n- THEN pass\n');

    const metaSup = fs.readFileSync(path.join(cdirSup, '.openspec.yaml'), 'utf8');
    assert.match(metaSup, /level: "L0"/);
    assert.match(metaSup, /workflowMode: "single-pr"/);
    assert.match(metaSup, /governanceMode: "supervised"/);

    // Supervised L0 allows direct apply without spec merge on main
    assert.doesNotThrow(() => {
      applyGuard('sup-doc', { repoRoot: tmp });
    });

    // 2. Create an L0 change with explicit --mode spec-first
    newChange('update test fixtures', { repoRoot: tmp, id: 'spec-first-doc', grill: false, openspec: false, mode: 'spec-first' });
    const cdirSpec = path.join(tmp, 'openspec', 'changes', 'spec-first-doc');
    fs.writeFileSync(path.join(cdirSpec, 'proposal.md'), '# Proposal: spec-first-doc\nDoc change\n');
    fs.writeFileSync(path.join(cdirSpec, 'tasks.md'), '## Tasks\n- [ ] task 1\n');
    fs.mkdirSync(path.join(cdirSpec, 'specs', 'guide'), { recursive: true });
    fs.writeFileSync(path.join(cdirSpec, 'specs', 'guide', 'spec.md'), '## Scenario: doc\n- GIVEN a doc\n- THEN pass\n');

    const metaSpec = fs.readFileSync(path.join(cdirSpec, '.openspec.yaml'), 'utf8');
    assert.match(metaSpec, /workflowMode: "spec-first"/);
    assert.match(metaSpec, /governanceMode: "spec-first"/);

    // In spec-first mode, apply MUST fail because spec PR is not merged on main
    assert.throws(() => {
      applyGuard('spec-first-doc', { repoRoot: tmp });
    }, /not approved/i);

    // 3. Status check under spec-first vs supervised
    const supNext = statusChange('sup-doc', { repoRoot: tmp, json: true });
    assert.equal(supNext, 0);

    // 4. Verify in supervised mode: passes locally (auto-merge denied), fails in CI without approved
    const cdir = path.join(tmp, 'openspec', 'changes', 'sup-doc');
    fs.mkdirSync(path.join(tmp, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'tests', 'demo.test.js'), '// test\n');
    fs.writeFileSync(path.join(cdir, 'proposal.md'), '# Proposal: sup-doc\n\n## Why\nDoc change.\n');
    fs.writeFileSync(path.join(cdir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 implement (AC1) verify: tests/demo.test.js\n');
    fs.mkdirSync(path.join(cdir, 'specs', 'guide'), { recursive: true });
    fs.writeFileSync(path.join(cdir, 'specs', 'guide', 'spec.md'),
      '# Spec Delta\n\n## Purpose\nA demo capability that exercises the BDD and AC quality harness.\n\n## ADDED Requirements\n\n### Requirement: Demo behavior\nThe system SHALL return a greeting.\n\n#### Scenario: Greeting\n- **GIVEN** a caller\n- **WHEN** it requests the greeting\n- **THEN** it receives "hello"\n\n**Acceptance criteria**\n- [ ] AC1: returns "hello" (test: tests/demo.test.js)\n\n## Constraints & NFRs\n\n## Out of Scope\n\n## Test Strategy\nUnit test asserts the greeting.\n');

    const verifyLocal = runVerify('sup-doc', { repoRoot: tmp, skipOpenspec: true, ci: false });
    assert.equal(verifyLocal, 0, 'Local verify passes with human-gate reporting auto-merge denied');

    const verifyCiUnapproved = runVerify('sup-doc', { repoRoot: tmp, skipOpenspec: true, ci: true });
    assert.equal(verifyCiUnapproved, 1, 'CI verify fails when PR is unapproved in supervised mode');

    const verifyCiApproved = runVerify('sup-doc', { repoRoot: tmp, skipOpenspec: true, ci: true, approved: true });
    assert.equal(verifyCiApproved, 0, 'CI verify passes when approved flag is set');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
