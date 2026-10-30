import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { assess } from '../src/assess/index.js';
import { renderPRComment } from '../src/assess/render.js';
import { judgeChangeSemantics, validateAIClassificationExpectation } from '../src/assess/ai_judge.js';
import { applyGuard } from '../src/commands/apply.js';
import { runVerify } from '../src/commands/verify.js';
import { installSchema } from '../src/lib/schema.js';
import { git } from '../src/lib/git.js';

installSchema();

function setupRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-simulation-'));
  git(['init', '-b', 'main'], tmp);
  git(['config', 'user.name', 'SimulationTester'], tmp);
  git(['config', 'user.email', 'sim@example.com'], tmp);
  fs.mkdirSync(path.join(tmp, 'openspec'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'openspec', 'config.yaml'), 'schema: agentic-repo-change\n');
  fs.writeFileSync(path.join(tmp, 'README.md'), '# Simulation Repo\n');
  git(['add', '.'], tmp);
  git(['commit', '-m', 'initial commit'], tmp);
  return tmp;
}

test('Simulation 1: Multi-language API modifications (Spring Boot, FastAPI, Go, NestJS) MUST be L2 Spec-First', () => {
  // 1. Spring Boot @RestController / Controller
  const springBoot = assess({
    stage: 'impl',
    changeId: 'spring-api',
    changedFiles: ['src/main/java/com/corp/order/OrderController.java'],
    persist: false
  });
  assert.equal(springBoot.risk.level, 'L2');
  assert.equal(springBoot.governance.workflow_mode, 'spec-first');
  assert.equal(springBoot.governance.spec_approval, 'human');

  // 2. FastAPI router / endpoint
  const fastApi = assess({
    stage: 'impl',
    changeId: 'fastapi-router',
    changedFiles: ['app/routers/payment_callback.py'],
    persist: false
  });
  assert.equal(fastApi.risk.level, 'L2');
  assert.equal(fastApi.governance.workflow_mode, 'spec-first');

  // 3. Go HTTP handler
  const goApi = assess({
    stage: 'impl',
    changeId: 'go-handler',
    changedFiles: ['internal/handlers/user_handler.go'],
    persist: false
  });
  assert.equal(goApi.risk.level, 'L2');
  assert.equal(goApi.governance.workflow_mode, 'spec-first');

  // 4. NestJS / Next.js API controller
  const nestApi = assess({
    stage: 'impl',
    changeId: 'nest-controller',
    changedFiles: ['src/users/users.controller.ts'],
    persist: false
  });
  assert.equal(nestApi.risk.level, 'L2');
  assert.equal(nestApi.governance.workflow_mode, 'spec-first');

  // 5. Semantic Requirement text triggers L2 for FastAPI & Spring Boot
  const reqFastApi = assess({
    stage: 'new',
    changeId: 'new-fastapi',
    requirement: 'add FastAPI router for customer address verification',
    persist: false
  });
  assert.equal(reqFastApi.risk.level, 'L2');
  assert.equal(reqFastApi.governance.workflow_mode, 'spec-first');

  const reqSpringBoot = assess({
    stage: 'new',
    changeId: 'new-springboot',
    requirement: 'refactor Spring Boot controller for shipment tracking',
    persist: false
  });
  assert.equal(reqSpringBoot.risk.level, 'L2');
  assert.equal(reqSpringBoot.governance.workflow_mode, 'spec-first');
});

test('Simulation 2: CI Workflows & GitHooks are routine L1 Tooling (Single PR, no Spec-first blocking)', () => {
  // 1. CI workflow file modification
  const ciRec = assess({
    stage: 'impl',
    changeId: 'update-ci',
    changedFiles: ['.github/workflows/ci.yml', '.githooks/pre-commit'],
    persist: false
  });
  assert.equal(ciRec.risk.level, 'L1');
  assert.equal(ciRec.governance.workflow_mode, 'single-pr');
  assert.equal(ciRec.governance.spec_approval, 'automatic');
  assert.equal(ciRec.governance.auto_approval, 'enabled');

  // 2. Requirement intent for CI / Workflow
  const reqCi = assess({
    stage: 'new',
    changeId: 'bump-ci-runner',
    requirement: 'upgrade github action workflow runner and githooks',
    persist: false
  });
  assert.equal(reqCi.risk.level, 'L1');
  assert.equal(reqCi.governance.workflow_mode, 'single-pr');
});

test('Simulation 3: End-to-end Lifecycle of L2 API change (apply is blocked until Spec PR is approved)', () => {
  const repo = setupRepo();
  try {
    const slug = 'fastapi-user-api';
    const cdir = path.join(repo, 'openspec', 'changes', slug);
    fs.mkdirSync(path.join(cdir, 'specs'), { recursive: true });

    fs.writeFileSync(path.join(cdir, 'proposal.md'), '# Proposal: FastAPI User API\n');
    fs.writeFileSync(path.join(cdir, 'specs', 'api-spec.md'), '## Spec: FastAPI endpoints\n');
    fs.writeFileSync(path.join(cdir, 'tasks.md'), '- [ ] 1. implement router\n');
    fs.writeFileSync(path.join(cdir, '.openspec.yaml'), 'schema: agentic-repo-change\nlevel: "L2"\nstatus: "drafting"\n');

    // 1. Attempting apply before approval MUST fail with NOT_APPROVED
    assert.throws(
      () => applyGuard(slug, { repoRoot: repo, targetBranch: 'main' }),
      (err) => err.code === 'NOT_APPROVED'
    );

    // 2. Simulate Spec PR approved & merged into main
    git(['add', 'openspec'], repo);
    git(['commit', '-m', 'spec: approve fastapi user api'], repo);

    // 3. Now applyGuard succeeds and transitions status to ready_for_impl
    assert.doesNotThrow(() => applyGuard(slug, { repoRoot: repo, targetBranch: 'main' }));

    const metaText = fs.readFileSync(path.join(cdir, '.openspec.yaml'), 'utf8');
    assert.match(metaText, /status:\s*"ready_for_impl"/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('Simulation 4: End-to-end Lifecycle of L1 CI change (apply permits direct implementation without Spec PR)', () => {
  const repo = setupRepo();
  try {
    const slug = 'ci-runner-bump';
    const cdir = path.join(repo, 'openspec', 'changes', slug);
    fs.mkdirSync(path.join(cdir, 'specs'), { recursive: true });

    fs.writeFileSync(path.join(cdir, 'proposal.md'), '# Proposal: CI runner bump\n');
    fs.writeFileSync(path.join(cdir, 'specs', 'ci-spec.md'), '## Spec: bump node\n');
    fs.writeFileSync(path.join(cdir, 'tasks.md'), '- [x] 1. bump node version\n');
    fs.writeFileSync(path.join(cdir, '.openspec.yaml'), 'schema: agentic-repo-change\nlevel: "L1"\nstatus: "drafting"\n');

    // For L1 Single-PR, applyGuard succeeds immediately without requiring a merged commit on main!
    assert.doesNotThrow(() => applyGuard(slug, { repoRoot: repo, targetBranch: 'main' }));

    const metaText = fs.readFileSync(path.join(cdir, '.openspec.yaml'), 'utf8');
    assert.match(metaText, /status:\s*"ready_for_impl"/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('Simulation 5: Risk Escape Gate detects undeclared L3 destructive operations and blocks verify', () => {
  const repo = setupRepo();
  try {
    const slug = 'minor-fix';
    const cdir = path.join(repo, 'openspec', 'changes', slug);
    fs.mkdirSync(path.join(cdir, 'specs'), { recursive: true });

    fs.writeFileSync(path.join(cdir, 'proposal.md'), '# Proposal: Minor internal fix\n');
    fs.writeFileSync(path.join(cdir, 'specs', 'fix-spec.md'), '## Spec: internal fix\n');
    fs.writeFileSync(path.join(cdir, 'tasks.md'), '- [x] 1. clean up table\n');
    // Change was declared as L1
    fs.writeFileSync(path.join(cdir, '.openspec.yaml'), 'schema: agentic-repo-change\nlevel: "L1"\nstatus: "ready_for_impl"\n');

    // Seed initial L1 assessment into risk-history.jsonl
    const initRec = assess({
      stage: 'new',
      changeId: slug,
      requirement: 'minor internal fix',
      repoRoot: repo
    });
    assert.equal(initRec.risk.level, 'L1');

    // Implementation silently adds a destructive drop table migration
    fs.mkdirSync(path.join(repo, 'migrations'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'migrations', '009_drop_user_table.sql'), 'DROP TABLE users;\n');
    fs.writeFileSync(path.join(repo, 'test_migration.test.js'), '// test\n');

    git(['add', '.'], repo);
    git(['commit', '-m', 'impl: sneaky drop table'], repo);

    // Verify catches the escalation and reports L3
    const exitCode = runVerify(slug, { repoRoot: repo, base: 'HEAD~1', head: 'HEAD' });
    assert.equal(exitCode, 1, 'verify should fail when L1 implementation sneaks in L3 destructive DDL');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('Simulation 6: In-Place Escalation after apply maintains single PR, revokes auto-merge, and enforces CI human gate', () => {
  const repo = setupRepo();
  const oldCI = process.env.CI;
  try {
    const slug = 'fastapi-helper';
    const cdir = path.join(repo, 'openspec', 'changes', slug);
    fs.mkdirSync(path.join(cdir, 'specs', 'user-cap'), { recursive: true });
    fs.writeFileSync(path.join(cdir, 'proposal.md'), '# Proposal\n\n## Why\nDemo helper.\n');
    fs.writeFileSync(path.join(cdir, 'specs', 'user-cap', 'spec.md'),
      `# Spec Delta\n\n## Purpose\nUser helper capability provides high performance user lookups and routing across the application.\n\n## ADDED Requirements\n\n### Requirement: User helper\nThe system SHALL serve users.\n\n#### Scenario: Get users\n- **GIVEN** a request\n- **WHEN** user endpoint called\n- **THEN** returns users\n\n**Acceptance criteria**\n- [ ] AC1: works (test: tests/api.test.js)\n\n## Constraints & NFRs\n\n## Out of Scope\n\n## Test Strategy\nUnit test.\n`);
    fs.writeFileSync(path.join(cdir, 'tasks.md'), '- [x] 1. add router (AC1) verify: tests/api.test.js\n');
    fs.writeFileSync(path.join(cdir, '.openspec.yaml'), 'schema: agentic-repo-change\nlevel: "L1"\nstatus: "ready_for_impl"\n');

    // Initial assessment recorded as L1
    assess({ stage: 'new', changeId: slug, requirement: 'refactor internal helper', repoRoot: repo });

    // Implementation touches FastAPI router (escalates to L2)
    fs.mkdirSync(path.join(repo, 'app', 'routers'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'app', 'routers', 'users.py'), '@router.get("/users")\ndef get_users(): pass\n');
    fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'tests', 'api.test.js'), '// test\n');

    git(['add', '.'], repo);
    git(['commit', '-m', 'impl: add users router'], repo);

    // 1. In Local environment: Single PR maintained in-place, level synced to L2, auto-merge denied
    const localExit = runVerify(slug, { repoRoot: repo, base: 'HEAD~1', head: 'HEAD', skipOpenspec: true, ci: false });
    assert.equal(localExit, 0, 'Local verify should pass in-place escalation without crashing developer workflow');

    const meta = fs.readFileSync(path.join(cdir, '.openspec.yaml'), 'utf8');
    assert.match(meta, /level: "L2"/);
    assert.match(meta, /escalatedInImpl: "true"/);

    // 2. In CI environment: Must fail human-gate if human lead approval is missing
    const ciExitUnapproved = runVerify(slug, { repoRoot: repo, base: 'HEAD~1', head: 'HEAD', skipOpenspec: true, ci: true });
    assert.equal(ciExitUnapproved, 1, 'CI verify MUST fail when escalated L2 PR has not been approved by human lead');

    // 3. In CI, committing review.md is self-attestation; passing approved: true simulates platform PR approval
    fs.writeFileSync(path.join(cdir, 'review.md'), '## Verdict\n\nAPPROVE\n\nApproved by Tech Lead.\n');
    const ciExitApproved = runVerify(slug, { repoRoot: repo, base: 'HEAD~1', head: 'HEAD', skipOpenspec: true, ci: true, approved: true });
    assert.equal(ciExitApproved, 0, 'CI verify MUST pass once Human Lead review is approved');
  } finally {
    if (oldCI !== undefined) process.env.CI = oldCI;
    else delete process.env.CI;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('Simulation 7: AI Semantic Classifier classifies test changes as L0 with zero friction', () => {
  // Pure test requirement
  const a1 = assess({
    stage: 'new',
    changeId: 'unit-tests',
    requirement: 'add unit test suite for payment calculation',
    persist: false
  });
  assert.equal(a1.risk.level, 'L0');
  assert.equal(a1.governance.workflow_mode, 'single-pr');
  assert.equal(a1.governance.auto_approval, 'enabled');

  // Pure test files modified
  const a2 = assess({
    stage: 'impl',
    changeId: 'unit-tests',
    changedFiles: ['tests/payment/calc_test.go', 'tests/fixtures/mock.json', 'src/components/button.test.js'],
    persist: false
  });
  assert.equal(a2.risk.level, 'L0');
  assert.equal(a2.governance.workflow_mode, 'single-pr');
});

test('Simulation 8: Expectation Invariant Validation catches adversarial attempt to mask AGENTS.md or drop table as a test', () => {
  // Adversary claims pure test, but secretly touches AGENTS.md
  const fakeAiOutput = {
    is_pure_test: true,
    is_pure_doc: false,
    classification: 'test_only',
    rationale: 'Trust me, this is just a unit test helper'
  };

  const check = validateAIClassificationExpectation(fakeAiOutput, {
    changedFiles: ['tests/foo.test.js', 'AGENTS.md'],
    requirement: 'add unit tests'
  });

  assert.equal(check.ok, false);
  assert.equal(check.override.is_pure_test, false);
  assert.equal(check.override.classification, 'governance_plane');

  // Full assessment rejects L0 and single-vetoes to L3!
  const a = assess({
    stage: 'impl',
    changeId: 'sneaky-test',
    changedFiles: ['tests/foo.test.js', 'AGENTS.md'],
    persist: false
  });
  assert.equal(a.risk.level, 'L3');
  assert.equal(a.governance.implementation_review, 'ai+human');
});

test('Simulation 9: Hidden --level option from CLI help', () => {
  const binPath = path.resolve('bin/asdlc.js');
  const helpOutput = execFileSync('node', [binPath, 'new', '--help'], { encoding: 'utf8' });
  assert.doesNotMatch(helpOutput, /--level/, '--level must be completely hidden from asdlc new --help');
});

test('Simulation 10: PR Comment renders high-visibility Level and Action highlight banners', () => {
  // L1 auto-merge change
  const l1Rec = assess({
    stage: 'new',
    changeId: 'helper-refactor',
    requirement: 'refactor internal math helper',
    persist: false
  });
  const l1Comment = renderPRComment(l1Rec);
  assert.match(l1Comment, /最终治理等级.*L1/);
  assert.match(l1Comment, /AI 自动合入.*Auto-Merge Eligible/);

  // In-place escalated change
  const l2EscalatedRec = {
    ...l1Rec,
    risk: { level: 'L2', confidence: 'high' },
    transition: { direction: 'up', from_level: 'L1', to_level: 'L2' },
    governance: { workflow_mode: 'single-pr', implementation_review: 'ai+human' }
  };
  const l2Comment = renderPRComment(l2EscalatedRec);
  assert.match(l2Comment, /治理动作：实施阶段升级 · 必须人工终审/);
  assert.match(l2Comment, /自动合并已关闭.*Auto-Merge DENIED/);
  assert.match(l2Comment, /最终治理等级.*L2/);
});

test('Simulation 11: Agent-assess escalation from L1 to L2 at spec stage blocks applyGuard with NOT_APPROVED', () => {
  const repo = setupRepo();
  try {
    const slug = 'agent-escalate-test';
    const cdir = path.join(repo, 'openspec', 'changes', slug);
    fs.mkdirSync(path.join(cdir, 'specs'), { recursive: true });

    fs.writeFileSync(path.join(cdir, 'proposal.md'), '# Proposal: Helper\n');
    fs.writeFileSync(path.join(cdir, 'specs', 'spec.md'), '## Spec: Helper\n');
    fs.writeFileSync(path.join(cdir, 'tasks.md'), '- [ ] 1. task\n');
    fs.writeFileSync(path.join(cdir, '.openspec.yaml'), 'schema: agentic-repo-change\nlevel: "L1"\nstatus: "drafting"\n');

    // Baseline assessment was L1
    assess({ stage: 'new', changeId: slug, requirement: 'minor helper', repoRoot: repo });

    // Agent writes .agent-assess.json during design because it added an API contract
    fs.writeFileSync(path.join(cdir, '.agent-assess.json'), JSON.stringify({
      classification: 'api_contract',
      contains_api_changes: true,
      rationale: 'Exposes new REST endpoint /api/v1/helper'
    }));

    // Calling applyGuard MUST escalate to L2 and block direct implementation with NOT_APPROVED
    assert.throws(
      () => applyGuard(slug, { repoRoot: repo, targetBranch: 'main' }),
      (err) => err.code === 'NOT_APPROVED'
    );

    // Verify .openspec.yaml was updated to L2
    const meta = fs.readFileSync(path.join(cdir, '.openspec.yaml'), 'utf8');
    assert.match(meta, /level: "L2"/);
    assert.match(meta, /workflowMode: "spec-first"/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

