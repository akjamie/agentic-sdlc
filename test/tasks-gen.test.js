import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { generateTasksFromSpecs } from '../src/lib/tasks-gen.js';
import { applyGuard } from '../src/commands/apply.js';

function initTmpRepo(slug) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-tasksgen-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  fs.mkdirSync(path.join(repo, 'openspec', 'changes', slug, 'specs', 'auth'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'openspec', 'changes', slug, '.openspec.yaml'), 'schema: agentic-repo-change\nlevel: L1\n');
  fs.writeFileSync(path.join(repo, 'openspec', 'changes', slug, 'proposal.md'), '# Proposal\n');
  fs.writeFileSync(path.join(repo, 'README.md'), '# Repo\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repo });
  return repo;
}

test('WP1 generateTasksFromSpecs: compiles [TEST]/[IMPL] pairs + UI tiers and preserves existing tasks.md', () => {
  const slug = 'auto-tasks';
  const repo = initTmpRepo(slug);
  const cdir = path.join(repo, 'openspec', 'changes', slug);

  fs.writeFileSync(path.join(cdir, 'specs', 'auth', 'spec.md'), [
    '## Purpose',
    'Authenticate users securely with JWT tokens.',
    '',
    '## ADDED Requirements',
    '### Requirement: Issue JWT Token',
    'System SHALL issue a signed JWT.',
    '#### Scenario: Valid login',
    'GIVEN valid credentials WHEN login THEN return JWT.',
    '**Acceptance criteria**',
    '- [ ] AC1: Returns signed JWT with 200 status (test: test/auth.test.js)',
  ].join('\n'));
  fs.writeFileSync(path.join(cdir, 'design.md'), '# Technical Design\n## UI/UX Design\n- Loading Skeleton & Empty State\n');

  const res = generateTasksFromSpecs(repo, slug);
  assert.equal(res.generated, true);
  assert.equal(res.acCount, 1);
  assert.equal(res.uiTasksIncluded, true);
  assert.equal(res.taskCount, 4);

  const tasksText = fs.readFileSync(path.join(cdir, 'tasks.md'), 'utf8');
  assert.match(tasksText, /\[UI\/DESIGN\]/);
  assert.match(tasksText, /\[UI\/COMPONENTS\]/);
  assert.match(tasksText, /\[TEST\] Write failing test for AC1: Returns signed JWT with 200 status \(`test\/auth\.test\.js`\)/);
  assert.match(tasksText, /\[IMPL\] Implement minimal code to satisfy AC1 \(`test\/auth\.test\.js`\)/);

  // Idempotent preservation: manual edits are never overwritten
  fs.writeFileSync(path.join(cdir, 'tasks.md'), '# Custom Tasks\n- [ ] 1.1 Keep me\n');
  const second = generateTasksFromSpecs(repo, slug);
  assert.equal(second.generated, false);
  assert.equal(second.reason, 'already_exists');
  assert.match(fs.readFileSync(path.join(cdir, 'tasks.md'), 'utf8'), /Keep me/);
});

test('WP1 applyGuard: auto-generates tasks.md in L1 Single-PR when missing, and still fails when specs lack ACs', () => {
  const slug = 'l1-auto-tasks';
  const repo = initTmpRepo(slug);
  const cdir = path.join(repo, 'openspec', 'changes', slug);

  // 1. No ACs -> TASKS_MISSING
  fs.writeFileSync(path.join(cdir, 'specs', 'auth', 'spec.md'), '## Purpose\nNo ACs yet.\n');
  assert.throws(
    () => applyGuard(slug, { repoRoot: repo, protectedBranch: 'main' }),
    (err) => err?.code === 'TASKS_MISSING'
  );

  // 2. Add valid AC -> applyGuard auto-generates tasks.md and succeeds
  fs.writeFileSync(path.join(cdir, 'specs', 'auth', 'spec.md'), [
    '### Requirement: Token Refresh',
    '- [ ] AC1: Refreshes valid token (test: test/refresh.test.js)',
  ].join('\n'));
  const exit = applyGuard(slug, { repoRoot: repo, protectedBranch: 'main' });
  assert.equal(exit, 0);
  assert.ok(fs.existsSync(path.join(cdir, 'tasks.md')));
});
