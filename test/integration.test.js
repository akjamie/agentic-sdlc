import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runLint } from '../src/commands/lint.js';
import { applyGuard } from '../src/commands/apply.js';
import { mergeChange } from '../src/commands/approve.js';

function tmpRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-int-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'README.md'), '# test');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'init'], { cwd: repo });
  return repo;
}

function scaffold(repo, changeId) {
  const slug = changeId.toLowerCase();
  const dir = path.join(repo, 'openspec', 'changes', slug);
  fs.mkdirSync(path.join(dir, 'specs', 'demo-cap'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.openspec.yaml'), `schema: agentic-repo-change\n`);
  fs.writeFileSync(path.join(dir, 'proposal.md'), '# Proposal\n\n## Why\nDemo the flow end to end for coverage.\n');
  fs.writeFileSync(path.join(dir, 'explore.md'), '# Explore\n\n> generatedAt: 2026-01-01T00:00:00Z\n');
  fs.writeFileSync(path.join(dir, 'review.md'), '# Review\n\n## Verdict\n\nAPPROVE\n\n## Blocking Findings\n(none)\n');
  fs.writeFileSync(path.join(dir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 implement (AC1) verify: tests/demo.test.js\n');
  fs.writeFileSync(path.join(dir, 'specs', 'demo-cap', 'spec.md'),
    `# Spec Delta\n\n## Purpose\nA demo capability that exercises the BDD and AC quality harness.\n\n## ADDED Requirements\n\n### Requirement: Demo behavior\nThe system SHALL return a greeting.\n\n#### Scenario: Greeting\n- **GIVEN** a caller\n- **WHEN** it requests the greeting\n- **THEN** it receives "hello"\n\n**Acceptance criteria**\n- [ ] AC1: returns "hello" (test: tests/demo.test.js)\n\n## Constraints & NFRs\n\n## Out of Scope\n\n## Test Strategy\nUnit test asserts the greeting.\n`);
  return dir;
}

test('lint: full pass on a complete change', () => {
  const repo = tmpRepo();
  scaffold(repo, 'TECH-1');
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tests', 'demo.test.js'), '// test\n');

  const exit = runLint('TECH-1', { repoRoot: repo, json: true });
  assert.equal(exit, 0);
});

test('lint: passes when design.md contains substantive technical specifications', () => {
  const repo = tmpRepo();
  const dir = scaffold(repo, 'TECH-1');
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tests', 'demo.test.js'), '// test\n');
  fs.writeFileSync(
    path.join(dir, 'design.md'),
    '# Technical Design\n\n## 1. System Architecture\nThis service uses a layered architecture with an in-memory TTL cache to eliminate redundant upstream calls.\n\n## 2. Interface Contracts\nTypeScript interfaces define request and response models strictly.\n',
  );

  const exit = runLint('TECH-1', { repoRoot: repo, json: true });
  assert.equal(exit, 0);
});

test('lint: fails when design.md contains only unedited template placeholders', () => {
  const repo = tmpRepo();
  const dir = scaffold(repo, 'TECH-1');
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tests', 'demo.test.js'), '// test\n');
  fs.writeFileSync(
    path.join(dir, 'design.md'),
    '# Technical Design: tech-1\n\n<!-- comment only placeholder -->\n<!-- another placeholder -->\n',
  );

  const exit = runLint('TECH-1', { repoRoot: repo, json: true });
  assert.equal(exit, 1);
});

test('lint: fails when change mentions UI/API but design.md is absent', () => {
  const repo = tmpRepo();
  const dir = scaffold(repo, 'UI-1');
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tests', 'demo.test.js'), '// test\n');
  fs.writeFileSync(
    path.join(dir, 'proposal.md'),
    '# Proposal\n\n## Why\nBuild a new web dashboard frontend for travel itinerary planning.\n',
  );
  const exit = runLint('UI-1', { repoRoot: repo, json: true });
  assert.equal(exit, 1);
});

test('lint: passes when change mentions UI/API and substantive design.md is present', () => {
  const repo = tmpRepo();
  const dir = scaffold(repo, 'UI-1');
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tests', 'demo.test.js'), '// test\n');
  fs.writeFileSync(
    path.join(dir, 'proposal.md'),
    '# Proposal\n\n## Why\nBuild a new web dashboard frontend for travel itinerary planning.\n',
  );
  fs.writeFileSync(
    path.join(dir, 'design.md'),
    '# Technical Design\n\n## 5. UI Architecture & Design System\nReference: Brand Token CSS at ui/tokens.css\nBreakpoints: Mobile (375px), Desktop (1280px)\nInteraction states: loading skeleton, empty state, error banner.\n',
  );
  const exit = runLint('UI-1', { repoRoot: repo, json: true });
  assert.equal(exit, 0);
});

test('lint: fails when review.md verdict is NEEDS_REVISION', () => {
  const repo = tmpRepo();
  const dir = scaffold(repo, 'TECH-1');
  fs.writeFileSync(path.join(dir, 'review.md'), '# Review\n\n## Verdict\n\nNEEDS_REVISION\n\n## Blocking Findings\n1. gap\n');
  const exit = runLint('TECH-1', { repoRoot: repo, json: true });
  assert.equal(exit, 1);
});

test('apply: refuses when spec is not approved on the protected branch', () => {
  const repo = tmpRepo();
  scaffold(repo, 'TECH-1');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'spec'], { cwd: repo });
  assert.throws(
    () => applyGuard('TECH-1', { repoRoot: repo, protectedBranch: 'origin/main' }),
    /not approved|no commit/,
  );
});

test('apply: passes when spec is approved (merged to main and status is ready_for_impl)', () => {
  const repo = tmpRepo();
  scaffold(repo, 'TECH-1');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'spec'], { cwd: repo });
  // Approve the change (records specSha, status: ready_for_impl)
  mergeChange('TECH-1', { repoRoot: repo });
  const exit = applyGuard('TECH-1', { repoRoot: repo, protectedBranch: 'main' });
  assert.equal(exit, 0);
});

test('apply: automatically recognizes PR merge on target branch and syncs status', () => {
  const repo = tmpRepo();
  const dir = scaffold(repo, 'TECH-1');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'spec'], { cwd: repo });
  // Spec commit merged directly to main via PR, but asdlc approve was never manually executed
  const exit = applyGuard('TECH-1', { repoRoot: repo, protectedBranch: 'main' });
  assert.equal(exit, 0);

  // Assert that applyGuard automatically transitioned the metadata to ready_for_impl
  const metaText = fs.readFileSync(path.join(dir, '.openspec.yaml'), 'utf8');
  assert.match(metaText, /status: "ready_for_impl"/);
  assert.match(metaText, /specSha:/);
});

test('apply: fails when locked spec files have uncommitted local modifications', () => {
  const repo = tmpRepo();
  const dir = scaffold(repo, 'TECH-1');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'spec'], { cwd: repo });
  mergeChange('TECH-1', { repoRoot: repo });
  // Tamper: dirty local modification to proposal.md
  fs.appendFileSync(path.join(dir, 'proposal.md'), '\nTampered content!\n');
  assert.throws(
    () => applyGuard('TECH-1', { repoRoot: repo, protectedBranch: 'main' }),
    /uncommitted local modifications|SPEC_DIRTY/,
  );
});

test('apply: concurrent changes do not interfere with each others approvedSha', () => {
  const repo = tmpRepo();
  const dir1 = scaffold(repo, 'TECH-1');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'spec(tech-1): add tech-1'], { cwd: repo });

  // Simulate concurrent developer adding another change AUTH-2 later on main
  const dir2 = path.join(repo, 'openspec', 'changes', 'auth-2');
  fs.mkdirSync(path.join(dir2, 'specs', 'auth'), { recursive: true });
  fs.writeFileSync(path.join(dir2, '.openspec.yaml'), `schema: agentic-repo-change\n`);
  fs.writeFileSync(path.join(dir2, 'proposal.md'), '# Proposal: AUTH-2\n');
  fs.writeFileSync(path.join(dir2, 'tasks.md'), '# Tasks\n- [ ] 1.1 auth\n');
  fs.writeFileSync(path.join(dir2, 'specs', 'auth', 'spec.md'), '# Spec\n');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'spec(auth-2): concurrent merge'], { cwd: repo });

  // TECH-1 applyGuard MUST succeed even though AUTH-2 is now the latest commit on main!
  const exit1 = applyGuard('TECH-1', { repoRoot: repo, protectedBranch: 'main' });
  assert.equal(exit1, 0, 'TECH-1 must succeed independently of AUTH-2');

  // AUTH-2 applyGuard also succeeds independently!
  const exit2 = applyGuard('AUTH-2', { repoRoot: repo, protectedBranch: 'main' });
  assert.equal(exit2, 0, 'AUTH-2 must succeed independently');
});

test('lint: passes when review.md is absent pre-merge', () => {
  const repo = tmpRepo();
  const dir = scaffold(repo, 'TECH-1');
  fs.rmSync(path.join(dir, 'review.md'));
  const exit = runLint('TECH-1', { repoRoot: repo, json: true });
  assert.equal(exit, 0);
});

test('approve: auto-creates review.md with APPROVE and specSha upon spec merge', () => {
  const repo = tmpRepo();
  const dir = scaffold(repo, 'TECH-1');
  fs.rmSync(path.join(dir, 'review.md'));
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'feat(spec): add TECH-1'], { cwd: repo });

  const slugs = mergeChange('TECH-1', { repoRoot: repo });
  assert.deepEqual(slugs, ['tech-1']);

  const reviewPath = path.join(dir, 'review.md');
  assert.ok(fs.existsSync(reviewPath), 'review.md should be auto-created by mergeChange');
  const reviewContent = fs.readFileSync(reviewPath, 'utf8');
  assert.match(reviewContent, /## Verdict\s+APPROVE/);
  assert.match(reviewContent, /## Approval Record/);
  assert.match(reviewContent, /specSha:/);

  const metaText = fs.readFileSync(path.join(dir, '.openspec.yaml'), 'utf8');
  assert.match(metaText, /status: ready_for_impl/);
});
