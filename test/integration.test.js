import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runLint } from '../src/commands/lint.js';
import { applyGuard } from '../src/commands/apply.js';

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

test('apply: passes when spec is approved (merged to main)', () => {
  const repo = tmpRepo();
  scaffold(repo, 'TECH-1');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'spec'], { cwd: repo });
  const exit = applyGuard('TECH-1', { repoRoot: repo, protectedBranch: 'main' });
  assert.equal(exit, 0);
});
