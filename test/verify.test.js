import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runVerify } from '../src/commands/verify.js';

function tmpRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-verify-'));
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
  fs.writeFileSync(path.join(dir, 'proposal.md'), '# Proposal\n\n## Why\nDemo change.\n');
  fs.writeFileSync(path.join(dir, 'explore.md'), '# Explore\n\n> generatedAt: 2026-01-01T00:00:00Z\n');
  fs.writeFileSync(path.join(dir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 implement (AC1) verify: tests/demo.test.js\n');
  fs.writeFileSync(path.join(dir, 'specs', 'demo-cap', 'spec.md'),
    `# Spec Delta\n\n## Purpose\nA demo capability that exercises the BDD and AC quality harness.\n\n## ADDED Requirements\n\n### Requirement: Demo behavior\nThe system SHALL return a greeting.\n\n#### Scenario: Greeting\n- **GIVEN** a caller\n- **WHEN** it requests the greeting\n- **THEN** it receives "hello"\n\n**Acceptance criteria**\n- [ ] AC1: returns "hello" (test: tests/demo.test.js)\n\n## Constraints & NFRs\n\n## Out of Scope\n\n## Test Strategy\nUnit test asserts the greeting.\n`);
  return dir;
}

test('runVerify: fails with test-presence when source code is added without tests', () => {
  const repo = tmpRepo();
  const dir = scaffold(repo, 'TECH-1');
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tests', 'demo.test.js'), '// test\n');

  // Spec commit on main
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'spec'], { cwd: repo });
  const specSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

  // Mark ready_for_impl in .openspec.yaml
  fs.writeFileSync(path.join(dir, '.openspec.yaml'), `schema: agentic-repo-change\nspecSha: "${specSha}"\nstatus: ready_for_impl\n`);
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'ready'], { cwd: repo });

  // Branch for impl
  execFileSync('git', ['checkout', '-qb', 'feat/tech-1'], { cwd: repo });

  // Developer touches source code in src/ but NO tests
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'greet.js'), 'export function greet() { return "hello"; }\n');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'code-without-tests'], { cwd: repo });

  const exitCode = runVerify('TECH-1', {
    repoRoot: repo,
    protectedBranch: 'main',
    skipOpenspec: true,
    skipExternal: true,
  });

  assert.equal(exitCode, 1, 'verify must fail when source code is modified without test files');
});

test('runVerify: passes test-presence when source code is accompanied by test files', () => {
  const repo = tmpRepo();
  const dir = scaffold(repo, 'TECH-1');
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tests', 'demo.test.js'), '// test\n');

  // Spec commit on main
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'spec'], { cwd: repo });
  const specSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

  // Mark ready_for_impl in .openspec.yaml
  fs.writeFileSync(path.join(dir, '.openspec.yaml'), `schema: agentic-repo-change\nspecSha: "${specSha}"\nstatus: ready_for_impl\n`);
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'ready'], { cwd: repo });

  // Branch for impl
  execFileSync('git', ['checkout', '-qb', 'feat/tech-1'], { cwd: repo });

  // Developer touches both source code and test files
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'greet.js'), 'export function greet() { return "hello"; }\n');
  fs.writeFileSync(path.join(repo, 'tests', 'demo.test.js'), '// updated test\n');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'code-and-tests'], { cwd: repo });

  const exitCode = runVerify('TECH-1', {
    repoRoot: repo,
    protectedBranch: 'main',
    skipOpenspec: true,
    skipExternal: true,
  });

  assert.equal(exitCode, 0, 'verify should pass when tests accompany code changes');
});

test('runVerify: fails with spec-tamper when implementation PR modifies locked spec files', () => {
  const repo = tmpRepo();
  const dir = scaffold(repo, 'TECH-1');
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tests', 'demo.test.js'), '// test\n');

  // Spec commit on main
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'spec'], { cwd: repo });
  const specSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

  // Mark ready_for_impl in .openspec.yaml
  fs.writeFileSync(path.join(dir, '.openspec.yaml'), `schema: agentic-repo-change\nspecSha: "${specSha}"\nstatus: ready_for_impl\n`);
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'ready'], { cwd: repo });

  // Branch for impl
  execFileSync('git', ['checkout', '-qb', 'feat/tech-1'], { cwd: repo });

  // Developer implements code AND tests, but also sneaks in an edit to proposal.md
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'greet.js'), 'export function greet() { return "hello"; }\n');
  fs.writeFileSync(path.join(repo, 'tests', 'demo.test.js'), '// updated test\n');
  fs.writeFileSync(path.join(dir, 'proposal.md'), '# Proposal\n\n## Why\nSneaky unauthorized change!\n');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'impl-with-tampered-spec'], { cwd: repo });

  const exitCode = runVerify('TECH-1', {
    repoRoot: repo,
    protectedBranch: 'main',
    skipOpenspec: true,
    skipExternal: true,
  });

  assert.equal(exitCode, 1, 'verify must reject implementation PR that modifies locked spec paths');
});
