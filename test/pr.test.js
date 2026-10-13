import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createSpecPR } from '../src/commands/pr.js';
import { mergeChange } from '../src/commands/approve.js';
import { applyGuard } from '../src/commands/apply.js';

function tmpRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-pr-test-'));
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
  fs.writeFileSync(path.join(dir, 'proposal.md'), '# Proposal: User Authentication With JWT\n\n## Why\nNeed secure JWT auth.\n\n## Capabilities\n- New auth capability\n');
  fs.writeFileSync(path.join(dir, 'explore.md'), '# Explore\n\n> generatedAt: 2026-01-01T00:00:00Z\n');
  fs.writeFileSync(path.join(dir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 implement (AC1) verify: test/auth.test.js\n');
  fs.writeFileSync(path.join(dir, 'specs', 'demo-cap', 'spec.md'),
    `# Spec Delta\n\n## Purpose\nA demo capability that exercises the BDD and AC quality harness.\n\n## ADDED Requirements\n\n### Requirement: Login\nThe system SHALL authenticate users.\n\n#### Scenario: Success\n- **GIVEN** credentials\n- **WHEN** submitted\n- **THEN** returns token\n\n**Acceptance criteria**\n- [ ] AC1: token returned (test: test/auth.test.js)\n\n## Constraints & NFRs\n\n## Out of Scope\n\n## Test Strategy\nUnit tests.\n`);
  return dir;
}

test('pr: fails when targetBranch is missing', async () => {
  const repo = tmpRepo();
  scaffold(repo, 'AUTH-1');
  await assert.rejects(
    async () => createSpecPR('AUTH-1', null, { repoRoot: repo }),
    /target branch is required/,
  );
});

test('pr: fails when trying to PR from branch into itself', async () => {
  const repo = tmpRepo();
  scaffold(repo, 'AUTH-1');
  await assert.rejects(
    async () => createSpecPR('AUTH-1', 'main', { repoRoot: repo }),
    /cannot create a PR from 'main' into itself/,
  );
});

test('pr: succeeds on feature branch and extracts title from proposal.md', async () => {
  const repo = tmpRepo();
  scaffold(repo, 'AUTH-1');
  execFileSync('git', ['checkout', '-b', 'spec/auth-1'], { cwd: repo });

  const res = await createSpecPR('AUTH-1', 'main', { repoRoot: repo });
  assert.equal(res.slug, 'auth-1');
  assert.equal(res.targetBranch, 'main');
  assert.equal(res.title, 'spec(auth-1): User Authentication With JWT');
});

test('applyGuard fails fast if Spec PR is not merged into targetBranch, passes after merge', () => {
  const repo = tmpRepo();
  scaffold(repo, 'AUTH-1');
  execFileSync('git', ['checkout', '-b', 'feat/auth-1'], { cwd: repo });
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'spec(auth-1): add spec'], { cwd: repo });

  // In-place approve on feature branch
  const approved = mergeChange('AUTH-1', { repoRoot: repo });
  assert.deepEqual(approved, ['auth-1']);

  // Fail-fast guard: applyGuard MUST fail if not merged into main
  assert.throws(
    () => applyGuard('AUTH-1', { repoRoot: repo, targetBranch: 'main' }),
    /not approved yet/
  );

  // Merge feature branch to main (simulating Spec PR merge)
  execFileSync('git', ['checkout', 'main'], { cwd: repo });
  execFileSync('git', ['merge', 'feat/auth-1', '--no-ff', '-m', 'merge: spec pr'], { cwd: repo });
  execFileSync('git', ['checkout', 'feat/auth-1'], { cwd: repo });

  // Now applyGuard succeeds!
  const exit = applyGuard('AUTH-1', { repoRoot: repo, targetBranch: 'main' });
  assert.equal(exit, 0);
});

test('parseRemoteUrl parses SSH and HTTPS remotes for GitHub and GitLab', async () => {
  const { parseRemoteUrl } = await import('../src/commands/pr.js');

  const ghSsh = parseRemoteUrl('git@github.com:akjamie/agentic-sdlc.git');
  assert.equal(ghSsh.host, 'github.com');
  assert.equal(ghSsh.repoPath, 'akjamie/agentic-sdlc');
  assert.equal(ghSsh.isGitHub, true);

  const ghHttps = parseRemoteUrl('https://github.com/my-org/my-project.git');
  assert.equal(ghHttps.host, 'github.com');
  assert.equal(ghHttps.repoPath, 'my-org/my-project');
  assert.equal(ghHttps.isGitHub, true);

  const glSsh = parseRemoteUrl('git@gitlab.com:enterprise/team/repo.git');
  assert.equal(glSsh.host, 'gitlab.com');
  assert.equal(glSsh.repoPath, 'enterprise/team/repo');
  assert.equal(glSsh.isGitLab, true);

  // Enterprise on-premise GitHub Enterprise Server
  const ghes = parseRemoteUrl('git@github.corp.internal:infra/agentic-sdlc.git');
  assert.equal(ghes.host, 'github.corp.internal');
  assert.equal(ghes.repoPath, 'infra/agentic-sdlc');
  assert.equal(ghes.isGitHub, true);

  // Enterprise on-premise GitLab with custom port and http protocol
  const onPremGl = parseRemoteUrl('http://code.internal.net:8080/group/project.git', { platform: 'gitlab' });
  assert.equal(onPremGl.host, 'code.internal.net:8080');
  assert.equal(onPremGl.protocol, 'http:');
  assert.equal(onPremGl.repoPath, 'group/project');
  assert.equal(onPremGl.isGitLab, true);

  assert.equal(parseRemoteUrl(null), null);
  assert.equal(parseRemoteUrl(''), null);
});


