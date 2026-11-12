import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolveTopology } from '../src/lib/level.js';
import { statusChange, statusPortfolio } from '../src/commands/status.js';
import { mergeChange } from '../src/commands/approve.js';
import { applyGuard } from '../src/commands/apply.js';
import { runVerify } from '../src/commands/verify.js';
import { git } from '../src/lib/git.js';
import { classifyPR } from '../src/lib/prtype.js';

function setupRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-sp-test-'));
  git(['init', '-b', 'main'], tmp);
  git(['config', 'user.name', 'test'], tmp);
  git(['config', 'user.email', 'test@test.com'], tmp);
  fs.mkdirSync(path.join(tmp, 'openspec', 'changes'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'README.md'), '# Test\n');
  git(['add', '.'], tmp);
  git(['commit', '-m', 'initial commit'], tmp);
  return tmp;
}

function createChange(tmp, slug, { level = 'L1', workflowMode = 'single-pr', status = 'draft', tasks = '- [ ] Task 1\n' } = {}) {
  const cdir = path.join(tmp, 'openspec', 'changes', slug);
  fs.mkdirSync(path.join(cdir, 'specs', 'core'), { recursive: true });
  fs.writeFileSync(path.join(cdir, '.openspec.yaml'), `schema: agentic-repo-change\nlevel: "${level}"\nworkflowMode: "${workflowMode}"\nstatus: "${status}"\n`);
  fs.writeFileSync(path.join(cdir, 'explore.md'), '# Explore\n');
  fs.writeFileSync(path.join(cdir, 'proposal.md'), `# Proposal: ${slug}\nWhy: test\n`);
  if (tasks !== null) {
    fs.writeFileSync(path.join(cdir, 'tasks.md'), tasks);
  }
  fs.writeFileSync(path.join(cdir, 'specs', 'core', 'spec.md'), `# Spec Delta\n\n## Purpose\nA demo capability that exercises the BDD and AC quality harness.\n\n## ADDED Requirements\n\n### Requirement: Demo behavior\nThe system SHALL return a greeting.\n\n#### Scenario: Greeting\n- **GIVEN** a caller\n- **WHEN** it requests the greeting\n- **THEN** it receives "hello"\n\n**Acceptance criteria**\n- [ ] AC1: returns "hello" (test: tests/demo.test.js)\n\n## Constraints & NFRs\n\n## Out of Scope\n\n## Test Strategy\nUnit test asserts the greeting.\n`);
  return cdir;
}

test('resolveTopology unit test', () => {
  const repo = setupRepo();
  try {
    createChange(repo, 'feat-l1', { level: 'L1', workflowMode: 'single-pr' });
    createChange(repo, 'feat-l2', { level: 'L2', workflowMode: 'spec-first' });
    createChange(repo, 'feat-l0', { level: 'L0', workflowMode: 'single-pr' });

    const topo1 = resolveTopology({ repoRoot: repo, slug: 'feat-l1' });
    assert.equal(topo1.isSinglePr, true);
    assert.equal(topo1.effectiveLevel, 'L1');

    const topo2 = resolveTopology({ repoRoot: repo, slug: 'feat-l2' });
    assert.equal(topo2.isSinglePr, false);
    assert.equal(topo2.effectiveLevel, 'L2');

    const topo0 = resolveTopology({ repoRoot: repo, slug: 'feat-l0' });
    assert.equal(topo0.isSinglePr, true);
    assert.equal(topo0.effectiveLevel, 'L0');

    // Override via cliMode: 'spec-first'
    const topo1SpecFirst = resolveTopology({ repoRoot: repo, slug: 'feat-l1', cliMode: 'spec-first' });
    assert.equal(topo1SpecFirst.isSinglePr, false);
    assert.match(topo1SpecFirst.reason, /spec-first/i);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('TC-SP-01: L1 Single-PR status shows [~] co-located in single PR, never approved on origin/main', () => {
  const repo = setupRepo();
  try {
    createChange(repo, 'l1-change', { level: 'L1', tasks: '- [ ] task 1\n' });

    const outputs = [];
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk) => {
      outputs.push(chunk);
      return true;
    };
    try {
      statusChange('l1-change', { repoRoot: repo, protectedBranch: 'origin/main' });
    } finally {
      process.stdout.write = origWrite;
    }

    const output = outputs.join('');
    assert.match(output, /\[~\] 3 spec approval \(co-located in single PR; human sign-off at merge\)/);
    assert.doesNotMatch(output, /3 spec approved on origin\/main/);
    assert.doesNotMatch(output, /\[x\] 3 spec/);
    assert.match(output, /next: asdlc apply l1-change, then complete tasks in tasks.md/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('TC-SP-02: L1 Single-PR approve <ID> exits 0, sets status: ready_for_impl without git tag or commit', () => {
  const repo = setupRepo();
  try {
    createChange(repo, 'l1-app', { level: 'L1', status: 'draft' });
    const cdir = path.join(repo, 'openspec', 'changes', 'l1-app');

    const approved = mergeChange('l1-app', { repoRoot: repo });
    assert.deepEqual(approved, ['l1-app']);

    const meta = fs.readFileSync(path.join(cdir, '.openspec.yaml'), 'utf8');
    assert.match(meta, /status:\s*['"]?ready_for_impl['"]?/);
    assert.doesNotMatch(meta, /specSha:/);

    // Verify git tag approved/L1-APP was NOT created
    const tags = git(['tag', '-l', 'approved/*'], repo, { allowFail: true }) || '';
    assert.doesNotMatch(tags, /approved\/L1-APP/);

    // Verify review.md was NOT created or modified
    assert.equal(fs.existsSync(path.join(cdir, 'review.md')), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('TC-SP-03: L1 Single-PR apply unblocks TDD and auto-completes ready_for_impl', () => {
  const repo = setupRepo();
  try {
    createChange(repo, 'l1-apply', { level: 'L1', status: 'draft' });
    const cdir = path.join(repo, 'openspec', 'changes', 'l1-apply');

    assert.doesNotThrow(() => {
      applyGuard('l1-apply', { repoRoot: repo });
    });

    const meta = fs.readFileSync(path.join(cdir, '.openspec.yaml'), 'utf8');
    assert.match(meta, /status:\s*['"]?ready_for_impl['"]?/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('TC-SP-04: L2 Dual-PR change retains Track A behavior in approve (not single-PR branch)', () => {
  const repo = setupRepo();
  try {
    createChange(repo, 'l2-change', { level: 'L2', workflowMode: 'spec-first', status: 'draft' });
    const cdir = path.join(repo, 'openspec', 'changes', 'l2-change');

    // In Track A, mergeChange takes the existing branch (creates review.md, tag, commit)
    const approved = mergeChange('l2-change', { repoRoot: repo });
    assert.deepEqual(approved, ['l2-change']);

    // Track A MUST have stamped review.md and specSha
    const meta = fs.readFileSync(path.join(cdir, '.openspec.yaml'), 'utf8');
    assert.match(meta, /specSha:/);
    assert.equal(fs.existsSync(path.join(cdir, 'review.md')), true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('TC-SP-05: L1 Single-PR verify and PR classify properly as single PR', () => {
  const repo = setupRepo();
  try {
    fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'tests', 'demo.test.js'), '// test\n');
    createChange(repo, 'l1-verify', { level: 'L1', tasks: '# Tasks\n\n- [x] 1.1 implement (AC1) verify: tests/demo.test.js\n' });
    const cdir = path.join(repo, 'openspec', 'changes', 'l1-verify');

    // Verify in supervised mode locally passes (human-gate requires approval on PR before merge)
    const exitCode = runVerify('l1-verify', { repoRoot: repo, skipOpenspec: true, skipExternal: true, ci: false });
    assert.equal(exitCode, 0);

    // classifyPR check
    const changedFiles = ['openspec/changes/l1-verify/proposal.md', 'openspec/changes/l1-verify/specs/core/spec.md', 'src/hello.js'];
    const pr = classifyPR({ changedFiles, changeOnMain: false, policy: {}, level: 'L1', singlePr: true });
    assert.equal(pr.type, 'impl');
    assert.match(pr.reason, /single PR flow/i);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('TC-SP-06: L1 Single-PR approve <ID> never bypasses human-gate (review.md has NO Verdict APPROVE)', () => {
  const repo = setupRepo();
  try {
    fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'tests', 'demo.test.js'), '// test\n');
    createChange(repo, 'l1-human-gate', { level: 'L1', tasks: '# Tasks\n\n- [x] 1.1 implement (AC1) verify: tests/demo.test.js\n' });
    const cdir = path.join(repo, 'openspec', 'changes', 'l1-human-gate');

    // Run approve
    mergeChange('l1-human-gate', { repoRoot: repo });

    // review.md MUST NOT exist (or have no Verdict APPROVE)
    if (fs.existsSync(path.join(cdir, 'review.md'))) {
      const reviewText = fs.readFileSync(path.join(cdir, 'review.md'), 'utf8');
      assert.doesNotMatch(reviewText, /##\s*Verdict\s*\n+\s*APPROVE/i);
    }

    // In CI mode, verify MUST fail without platform approval
    const ciExit = runVerify('l1-human-gate', { repoRoot: repo, skipOpenspec: true, skipExternal: true, ci: true });
    assert.equal(ciExit, 1, 'CI verify must fail because human lead has not approved the single PR');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('TC-SP-07: Declared L1 but tampered history L2 does not take Single-PR branch', () => {
  const repo = setupRepo();
  try {
    createChange(repo, 'tamper-change', { level: 'L1', tasks: '- [x] task 1\n' });
    const cdir = path.join(repo, 'openspec', 'changes', 'tamper-change');

    // Write risk-history with L2 record
    const historyRecord = {
      timestamp: new Date().toISOString(),
      stage: 'new',
      risk: { level: 'L2', score: 25 },
      vectors: {},
      hash: 'testhash'
    };
    fs.writeFileSync(path.join(cdir, 'risk-history.jsonl'), JSON.stringify(historyRecord) + '\n');

    const topo = resolveTopology({ repoRoot: repo, slug: 'tamper-change' });
    assert.equal(topo.isSinglePr, false);
    assert.equal(topo.tampered, true);

    // approve should NOT take single-pr branch; it falls through to Track A
    mergeChange('tamper-change', { repoRoot: repo });
    const meta = fs.readFileSync(path.join(cdir, '.openspec.yaml'), 'utf8');
    // Track A stamped specSha
    assert.match(meta, /specSha:/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('TC-SP-08: Change with workflowMode: spec-first or --mode spec-first retains Track A', () => {
  const repo = setupRepo();
  try {
    createChange(repo, 'spec-first-change', { level: 'L1', workflowMode: 'spec-first' });
    const topo = resolveTopology({ repoRoot: repo, slug: 'spec-first-change' });
    assert.equal(topo.isSinglePr, false);

    const topoCli = resolveTopology({ repoRoot: repo, slug: 'spec-first-change', cliMode: 'spec-first' });
    assert.equal(topoCli.isSinglePr, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('TC-SP-09: --mode auto with L0/L1 behaves consistently with single PR topology', () => {
  const repo = setupRepo();
  try {
    createChange(repo, 'auto-change', { level: 'L1' });
    const topo = resolveTopology({ repoRoot: repo, slug: 'auto-change', cliMode: 'auto' });
    assert.equal(topo.isSinglePr, true);
    assert.equal(topo.mode, 'auto');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('TC-SP-10: Post-merge hook without changeId (mergeChange(undefined)) retains legacy behavior', () => {
  const repo = setupRepo();
  try {
    // When no changeId is given and no commit touched changes dir, returns []
    const approved = mergeChange(undefined, { repoRoot: repo });
    assert.deepEqual(approved, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('TC-SP-11: status --json schema includes non-breaking fields in single-pr and matches baseline in dual-pr', () => {
  const repo = setupRepo();
  try {
    createChange(repo, 'sp-json', { level: 'L1' });
    createChange(repo, 'dual-json', { level: 'L2', workflowMode: 'spec-first' });

    const outputs = [];
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk) => {
      outputs.push(chunk);
      return true;
    };
    try {
      statusChange('sp-json', { repoRoot: repo, json: true });
      const spJson = JSON.parse(outputs.join(''));
      assert.equal(spJson.mode, 'single-pr');
      assert.equal(spJson.approvalTrack, 'colocated');
      assert.equal(spJson.stage[3].ok, true);

      outputs.length = 0;
      statusChange('dual-json', { repoRoot: repo, json: true });
      const dualJson = JSON.parse(outputs.join(''));
      assert.equal(dualJson.mode, undefined);
      assert.equal(dualJson.approvalTrack, undefined);
      assert.equal(dualJson.level, 'L2');
    } finally {
      process.stdout.write = origWrite;
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
