import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { assess } from '../src/assess/index.js';
import { applyGuard } from '../src/commands/apply.js';
import { runVerify } from '../src/commands/verify.js';
import { git } from '../src/lib/git.js';

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

    // Verify MUST catch the escalation and fail
    const exitCode = runVerify(slug, { repoRoot: repo, base: 'HEAD~1', head: 'HEAD' });
    assert.equal(exitCode, 1, 'verify should fail when L1 implementation sneaks in L3 destructive DDL');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
