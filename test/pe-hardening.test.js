import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildCli } from '../src/cli.js';
import { deriveChangeSlug, extractRequirementTerms } from '../src/lib/cliutil.js';
import { assess } from '../src/assess/index.js';
import { readEffectiveLevel } from '../src/lib/level.js';
import { checkTaskEvidence } from '../src/lib/tdd.js';
import { ensureOpenspec, findOpenspec } from '../src/lib/openspec.js';
import { checkSchema } from '../src/lib/schema.js';
import { ensureGraphify } from '../src/lib/graphify.js';
import { archiveChange } from '../src/commands/archive.js';
import { runVerify } from '../src/commands/verify.js';
import * as verifyMod from '../src/commands/verify.js';
import * as prMod from '../src/commands/pr.js';
import * as testMod from '../src/commands/test.js';
import * as archiveMod from '../src/commands/archive.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tmpGitRepo(prefix = 'asdlc-pe-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Clean Polyglot Repo\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

// ============================================================================
// WS-1: Legacy CI / Hooks Cleanup & Bounded Verifier Diff
// ============================================================================

test('WS-1: legacy jenkins/, assets/ci/, and .githooks/ stubs are removed', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'jenkins')), false, 'jenkins/ directory must be removed');
  assert.equal(fs.existsSync(path.join(repoRoot, 'assets', 'ci')), false, 'assets/ci/ stub directory must be removed');
  assert.equal(fs.existsSync(path.join(repoRoot, 'assets', 'githooks')), false, 'assets/githooks/ must be removed');
  assert.equal(fs.existsSync(path.join(repoRoot, '.githooks')), false, '.githooks/ must be removed');

  const initCmd = buildCli().commands.find((c) => c.name() === 'init');
  const optFlags = initCmd.options.map((o) => o.long);
  assert.ok(!optFlags.includes('--ci'), 'init must not expose broken --ci flag');
});

test('WS-1: buildVerifierDiffPayload bounds large diffs with file summary instead of overflowing stdin', () => {
  assert.equal(typeof verifyMod.buildVerifierDiffPayload, 'function', 'buildVerifierDiffPayload must be exported');
  const hugeHunk = Array.from({ length: 1000 }, (_, i) => `+export const line_${i} = ${i};`).join('\n');
  const hugeDiff = `diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1,1 +1,1000 @@\n${hugeHunk}\ndiff --git a/src/b.js b/src/b.js\n--- a/src/b.js\n+++ b/src/b.js\n@@ -1,1 +1,5 @@\n+export const b = true;\n`;

  const bounded = verifyMod.buildVerifierDiffPayload(hugeDiff, { maxChars: 2000 });
  assert.ok(bounded.length <= 2600, `bounded payload too large: ${bounded.length}`);
  assert.match(bounded, /src\/a\.js/);
  assert.match(bounded, /src\/b\.js/);
  assert.match(bounded, /truncated|asdlc-impl-review/i);
});

// ============================================================================
// WS-2: Bilingual Risk Engine, Anti-Downgrade Ratchet & Branch History Anchor
// ============================================================================

test('WS-2: Chinese high-risk requirement classifies as L3 spec-first and maps English AST query terms & readable slug', () => {
  const req = '重构支付清结算接口并清理历史账务表';

  // 1. Risk classification must hit L3 (financial + destructive table cleanup)
  const rec = assess({
    stage: 'new',
    changeId: 'cn-payment-purge',
    requirement: req,
    persist: false,
  });
  assert.equal(rec.risk.level, 'L3', 'Chinese financial + table cleanup requirement must be L3');
  assert.equal(rec.governance.workflow_mode, 'spec-first');
  assert.equal(rec.governance.implementation_review, 'ai+human');

  // 2. Slug derivation produces readable domain slug instead of opaque hash
  const slug = deriveChangeSlug(req);
  assert.doesNotMatch(slug, /^change-[a-z0-9]+$/, `Expected semantic domain slug, got ${slug}`);
  assert.match(slug, /payment|clearing|settlement|ledger/);

  // 3. Requirement term extraction bridges Chinese domain concepts to English code symbols for Graphify
  const terms = extractRequirementTerms(req);
  assert.match(terms, /payment/);
  assert.match(terms, /settlement|clearing|ledger/);
});

test('WS-2: Escalate-Only Ratchet prevents .agent-assess.json from downgrading L1/L2/L3 requirements', () => {
  const tmp = tmpGitRepo('asdlc-ratchet-');
  try {
    // Case A: Author agent attempts to disguise Chinese L3 requirement as internal_code (L1)
    const cdirA = path.join(tmp, 'openspec', 'changes', 'sneaky-cn');
    fs.mkdirSync(cdirA, { recursive: true });
    fs.writeFileSync(path.join(cdirA, '.agent-assess.json'), JSON.stringify({
      is_pure_test: false,
      is_pure_doc: false,
      contains_destructive_ops: false,
      contains_api_changes: false,
      classification: 'internal_code',
      rationale: 'Just a minor internal cleanup',
    }));

    const recA = assess({
      stage: 'new',
      changeId: 'sneaky-cn',
      requirement: '删除历史用户密钥表并重构鉴权逻辑',
      repoRoot: tmp,
      persist: false,
    });
    assert.equal(recA.risk.level, 'L3');

    // Case B: Author agent attempts to downgrade an L1 code refactor to L0 pure_doc at stage new
    const cdirB = path.join(tmp, 'openspec', 'changes', 'sneaky-l0');
    fs.mkdirSync(cdirB, { recursive: true });
    fs.writeFileSync(path.join(cdirB, '.agent-assess.json'), JSON.stringify({
      is_pure_test: false,
      is_pure_doc: true,
      classification: 'doc_only',
      rationale: 'Pretending core engine refactor is documentation only',
    }));

    const recB = assess({
      stage: 'new',
      changeId: 'sneaky-l0',
      requirement: 'refactor order state machine retry logic',
      repoRoot: tmp,
      persist: false,
    });
    assert.notEqual(recB.risk.level, 'L0', 'Agent self-assessment must NOT downgrade code requirement to L0');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('WS-2: Target-branch history anchor catches local risk-history.jsonl deletion & reset attack', () => {
  const repo = tmpGitRepo('asdlc-chain-reset-');
  try {
    const slug = 'sec-ledger';
    const cdir = path.join(repo, 'openspec', 'changes', slug);
    fs.mkdirSync(path.join(cdir, 'specs', 'ledger'), { recursive: true });
    fs.writeFileSync(path.join(cdir, 'proposal.md'), '# Proposal\n\n## Why\nUpdate ledger.\n');
    fs.writeFileSync(path.join(cdir, 'explore.md'), '# Explore\n\n> generatedAt: 2026-01-01T00:00:00Z\n');
    fs.writeFileSync(path.join(cdir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 [TEST] test ledger (AC1) verify: tests/ledger.test.js\n');
    fs.writeFileSync(path.join(cdir, 'specs', 'ledger', 'spec.md'),
      '# Spec\n\n## Purpose\nLedger capability with strict financial audit guarantees.\n\n## ADDED Requirements\n\n### Requirement: Ledger\nThe system SHALL record entries.\n\n#### Scenario: Entry\n- **GIVEN** tx\n- **WHEN** posted\n- **THEN** recorded\n\n**Acceptance criteria**\n- [ ] AC1: recorded (test: tests/ledger.test.js)\n\n## Constraints & NFRs\n\n## Out of Scope\n\n## Test Strategy\nUnit test.\n');

    // Record L3 assessment on main
    assess({ stage: 'new', changeId: slug, requirement: 'modify payment ledger settlement', repoRoot: repo, persist: true });
    fs.writeFileSync(path.join(cdir, '.openspec.yaml'), 'schema: agentic-repo-change\nlevel: "L3"\nstatus: "ready_for_impl"\n');
    fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'tests', 'ledger.test.js'), 'import { test } from "node:test"; test("ok", () => {});\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'approve L3 spec on main'], { cwd: repo });

    // Branch off and try the PE Blocker 3 attack: delete risk-history.jsonl + .openspec.yaml and regenerate seq:1 as L1!
    execFileSync('git', ['checkout', '-qb', 'impl/sec-ledger'], { cwd: repo });
    fs.rmSync(path.join(cdir, 'risk-history.jsonl'));
    fs.writeFileSync(path.join(cdir, '.openspec.yaml'), 'schema: agentic-repo-change\nlevel: "L1"\nstatus: "ready_for_impl"\n');
    assess({ stage: 'new', changeId: slug, requirement: 'refactor internal helper', repoRoot: repo, persist: true });

    const eff = readEffectiveLevel(repo, slug, { baseRef: 'main' });
    assert.equal(eff.tampered, true, 'Resetting risk-history.jsonl below target branch history MUST be flagged as tampered');
    assert.equal(eff.effectiveLevel, 'L3');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ============================================================================
// WS-3: Smart Git Staging (Denylist + >50MB) & Conflict-Free Post-Merge Archive
// ============================================================================

test('WS-3: stageImplementationChanges stages normal code & >5MB assets, skips secrets/dumps/>50MB with warning', () => {
  assert.equal(typeof prMod.stageImplementationChanges, 'function', 'stageImplementationChanges must be exported');
  const repo = tmpGitRepo('asdlc-smart-stage-');
  try {
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'assets'), { recursive: true });

    // Safe files that SHOULD be staged (including .env.example and an 8MB binary asset < 50MB)
    fs.writeFileSync(path.join(repo, 'src', 'feature.js'), 'export const ok = 1;\n');
    fs.writeFileSync(path.join(repo, '.env.example'), 'API_URL=https://example.com\n');
    fs.writeFileSync(path.join(repo, 'assets', 'demo.bin'), Buffer.alloc(6 * 1024 * 1024, 1)); // 6MB (< 50MB) -> MUST stage!

    // Dangerous / dump / >50MB files that MUST be skipped with warning
    fs.writeFileSync(path.join(repo, '.env.local'), 'SECRET_KEY=supersecret\n');
    fs.writeFileSync(path.join(repo, 'server.pem'), '-----BEGIN PRIVATE KEY-----\n');
    fs.writeFileSync(path.join(repo, 'java_pid123.hprof'), 'heapdump');
    fs.writeFileSync(path.join(repo, 'debug.log'), 'trace output');
    fs.writeFileSync(path.join(repo, 'huge.bin'), Buffer.alloc(2 * 1024 * 1024, 1)); // test custom 1MB override or 51MB

    // Also test real 50MB default by writing a 51MB file
    fs.writeFileSync(path.join(repo, 'oversized-51mb.dat'), Buffer.alloc(51 * 1024 * 1024, 0));

    const result = prMod.stageImplementationChanges(repo);
    const stagedOut = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repo, encoding: 'utf8' })
      .split(/\r?\n/).filter(Boolean);

    assert.ok(stagedOut.includes('src/feature.js'), 'legitimate source file must be staged');
    assert.ok(stagedOut.includes('.env.example'), '.env.example template must be staged');
    assert.ok(stagedOut.includes('assets/demo.bin'), '6MB asset (<50MB) must NOT be blocked');
    assert.ok(stagedOut.includes('huge.bin'), '2MB file (<50MB) must be staged');

    assert.ok(!stagedOut.includes('.env.local'), '.env.local must be skipped');
    assert.ok(!stagedOut.includes('server.pem'), '*.pem private key must be skipped');
    assert.ok(!stagedOut.includes('java_pid123.hprof'), '*.hprof dump must be skipped');
    assert.ok(!stagedOut.includes('debug.log'), '*.log file must be skipped');
    assert.ok(!stagedOut.includes('oversized-51mb.dat'), '>50MB file must be skipped');
    assert.ok(result.skipped.length >= 5);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('WS-3: archiveChange does not pollute root README.md or AGENTS.md and supports --merged batch compaction', () => {
  assert.equal(typeof archiveMod.archiveMergedChanges, 'function', 'archiveMergedChanges must be exported');
  const repo = tmpGitRepo('asdlc-batch-arch-');
  try {
    const initialReadme = fs.readFileSync(path.join(repo, 'README.md'), 'utf8');
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# Agents\n');

    for (const slug of ['feat-alpha', 'feat-beta']) {
      const cdir = path.join(repo, 'openspec', 'changes', slug);
      fs.mkdirSync(path.join(cdir, 'specs', slug), { recursive: true });
      fs.writeFileSync(path.join(cdir, '.openspec.yaml'), 'schema: agentic-repo-change\nstatus: "ready_for_impl"\n');
      fs.writeFileSync(path.join(cdir, 'proposal.md'), `# Proposal: ${slug}\n\n## Why\nShip ${slug}.\n`);
      fs.writeFileSync(path.join(cdir, 'tasks.md'), `- [x] 1.1 implement ${slug} (AC1) verify: test/a.test.js\n`);
      fs.writeFileSync(path.join(cdir, 'specs', slug, 'spec.md'), `# Spec: ${slug}\n`);
    }
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'merge feat-alpha and feat-beta'], { cwd: repo });

    const code = archiveMod.archiveMergedChanges({ repoRoot: repo, openspec: false, graph: false });
    assert.equal(code, 0);

    // Root README.md and AGENTS.md MUST remain untouched (zero merge conflict hotspot!)
    assert.equal(fs.readFileSync(path.join(repo, 'README.md'), 'utf8'), initialReadme);
    assert.equal(fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), '# Agents\n');

    // Both changes moved to openspec/changes/archive/ and specs synced to openspec/specs/
    assert.equal(fs.existsSync(path.join(repo, 'openspec', 'changes', 'feat-alpha')), false);
    assert.equal(fs.existsSync(path.join(repo, 'openspec', 'changes', 'feat-beta')), false);
    assert.equal(fs.existsSync(path.join(repo, 'openspec', 'specs', 'feat-alpha', 'spec.md')), true);
    assert.equal(fs.existsSync(path.join(repo, 'openspec', 'specs', 'feat-beta', 'spec.md')), true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ============================================================================
// WS-4: Zero-Intrusion Non-Node Repo, Stateless Schema & Intranet Graphify
// ============================================================================

test('WS-4: ensureOpenspec uses bundled engine and never pollutes Go/Java repo with package.json or node_modules', () => {
  const goRepo = tmpGitRepo('asdlc-golang-');
  try {
    fs.writeFileSync(path.join(goRepo, 'go.mod'), 'module example.com/payment\n\ngo 1.22\n');
    const res = ensureOpenspec(goRepo);
    assert.equal(res.installed, true, 'openspec should resolve via bundled dependency');
    assert.ok(findOpenspec(goRepo), 'findOpenspec should locate bundled binary');
    assert.equal(fs.existsSync(path.join(goRepo, 'package.json')), false, 'MUST NOT create package.json in Go repo');
    assert.equal(fs.existsSync(path.join(goRepo, 'node_modules')), false, 'MUST NOT create node_modules in Go repo');
  } finally {
    fs.rmSync(goRepo, { recursive: true, force: true });
  }
});

test('WS-4: checkSchema stateless mode succeeds in ephemeral container without host ~/.local/share/openspec', () => {
  const emptyXdg = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-empty-pod-'));
  const repo = tmpGitRepo('asdlc-pod-repo-');
  try {
    const res = checkSchema(repo, {
      env: { XDG_DATA_HOME: emptyXdg },
      platform: 'linux',
      homedir: emptyXdg,
      stateless: true,
      expectedVersion: '1',
    });
    assert.equal(res.ok, true, `Stateless container schema check should pass via bundled schema, got: ${res.reason}`);
  } finally {
    fs.rmSync(emptyXdg, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('WS-4: ensureGraphify respects ASDLC_OFFLINE=1 without attempting external network installs', () => {
  const res = ensureGraphify({
    autoInstall: true,
    env: { ...process.env, PATH: '', ASDLC_OFFLINE: '1' },
  });
  assert.equal(res.installed, false);
  assert.equal(res.action, 'offline-skipped');
});

// ============================================================================
// WS-5: Polyglot Test Runner Detection, Standalone [IMPL] Guard & Verify Tests
// ============================================================================

test('WS-5: detectTestRunner selects Vitest, Jest, scoped Maven -Dtest, and Gradle --tests accurately', () => {
  assert.equal(typeof testMod.detectTestRunner, 'function', 'detectTestRunner must be exported');

  // 1. TypeScript + Vitest
  const vitestRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-vitest-'));
  fs.writeFileSync(path.join(vitestRepo, 'package.json'), JSON.stringify({ devDependencies: { vitest: '^2.0.0' } }));
  assert.match(testMod.detectTestRunner(vitestRepo, ['src/auth.test.ts']), /vitest run/);
  fs.rmSync(vitestRepo, { recursive: true, force: true });

  // 2. TypeScript + Jest
  const jestRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-jest-'));
  fs.writeFileSync(path.join(jestRepo, 'package.json'), JSON.stringify({ devDependencies: { jest: '^29.0.0' } }));
  assert.match(testMod.detectTestRunner(jestRepo, ['src/auth.spec.ts']), /jest/);
  fs.rmSync(jestRepo, { recursive: true, force: true });

  // 3. Java + Maven -> scoped -Dtest=ClassA,ClassB (NOT full-repo mvn test!)
  const mvnRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-mvn-'));
  fs.writeFileSync(path.join(mvnRepo, 'pom.xml'), '<project></project>');
  const mvnCmd = testMod.detectTestRunner(mvnRepo, [
    'src/test/java/com/acme/OrderServiceTest.java',
    'src/test/java/com/acme/PaymentIT.java',
  ]);
  assert.match(mvnCmd, /mvn test -Dtest=OrderServiceTest,PaymentIT/);
  fs.rmSync(mvnRepo, { recursive: true, force: true });

  // 4. Java/Kotlin + Gradle -> scoped --tests
  const gradleRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-gradle-'));
  fs.writeFileSync(path.join(gradleRepo, 'build.gradle.kts'), '');
  const gradleCmd = testMod.detectTestRunner(gradleRepo, ['src/test/kotlin/com/acme/LedgerTest.kt']);
  assert.match(gradleCmd, /gradle.*test.*--tests LedgerTest/);
  fs.rmSync(gradleRepo, { recursive: true, force: true });
});

test('WS-5: checkTaskEvidence blocks standalone "[IMPL] 写完了" gaming without [TEST] or verification', () => {
  const gamedTasks = `# Tasks\n- [x] 1.1 [IMPL] 写完了\n`;
  const res = checkTaskEvidence(gamedTasks);
  assert.equal(res.ok, false, 'Bare [IMPL] without paired [TEST] or verify/AC evidence MUST fail');
});

test('WS-5: runVerify executes mapped acceptance tests by default when skipExternal is false', () => {
  const repo = tmpGitRepo('asdlc-verify-realtest-');
  try {
    const slug = 'failing-ac-impl';
    const cdir = path.join(repo, 'openspec', 'changes', slug);
    fs.mkdirSync(path.join(cdir, 'specs', 'calc'), { recursive: true });
    fs.writeFileSync(path.join(cdir, '.openspec.yaml'), 'schema: agentic-repo-change\nlevel: "L1"\nstatus: "ready_for_impl"\n');
    fs.writeFileSync(path.join(cdir, 'proposal.md'), '# Proposal\n\n## Why\nCalculator.\n');
    fs.writeFileSync(path.join(cdir, 'explore.md'), '# Explore\n\n> generatedAt: 2026-01-01T00:00:00Z\n');
    fs.writeFileSync(path.join(cdir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 [TEST] add failing test (AC1) verify: test/calc.test.js\n');
    fs.writeFileSync(path.join(cdir, 'specs', 'calc', 'spec.md'),
      '# Spec\n\n## Purpose\nCalculator capability with deterministic arithmetic verification.\n\n## ADDED Requirements\n\n### Requirement: Add\nThe system SHALL add numbers.\n\n#### Scenario: Sum\n- **GIVEN** 1 and 2\n- **WHEN** added\n- **THEN** returns 3\n\n**Acceptance criteria**\n- [ ] AC1: 1+2=3 (test: test/calc.test.js)\n\n## Constraints & NFRs\n\n## Out of Scope\n\n## Test Strategy\nUnit test.\n');

    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'test'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'calc.js'), 'export const add = () => 999;\n');
    fs.writeFileSync(path.join(repo, 'test', 'calc.test.js'),
      'import { test } from "node:test"; import assert from "node:assert/strict"; test("sum", () => { assert.equal(999, 3); });\n');

    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'impl with broken test'], { cwd: repo });

    const exitBroken = runVerify(slug, {
      repoRoot: repo,
      base: 'HEAD~1',
      head: 'HEAD',
      protectedBranch: 'main',
      skipOpenspec: true,
    });
    assert.equal(exitBroken, 1, 'runVerify MUST fail when mapped acceptance test fails');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ============================================================================
// Post-Review Hardening: 4 PE-Identified Verification Tests
// ============================================================================

test('PE Finding 1: verify CLI registers --approved, --emergency, --required, --repo-root and does not expose broken --ci', () => {
  const cli = buildCli();
  const verifyCmd = cli.commands.find((c) => c.name() === 'verify');
  assert.ok(verifyCmd, 'verify command must exist in CLI');

  const registeredOpts = verifyCmd.options.map((o) => o.long);
  assert.ok(registeredOpts.includes('--approved'), '--approved must be registered in verify CLI');
  assert.ok(registeredOpts.includes('--emergency'), '--emergency must be registered in verify CLI');
  assert.ok(registeredOpts.includes('--required'), '--required must be registered in verify CLI');
  assert.ok(registeredOpts.includes('--repo-root'), '--repo-root must be registered in verify CLI');
  assert.ok(registeredOpts.includes('--json'), '--json must be registered in verify CLI');
  assert.ok(!registeredOpts.includes('--ci'), 'verify must NOT expose --ci flag (Agentic SDLC is CI-agnostic and agent-driven)');
});

test('PE Finding 2: asdlc pr stages uncommitted working tree before pre-flight runVerify, catching unstaged spec-tamper', async () => {
  const repo = tmpGitRepo('asdlc-pr-stage-order-');
  try {
    const slug = 'tamper-in-working-tree';
    const cdir = path.join(repo, 'openspec', 'changes', slug);
    fs.mkdirSync(path.join(cdir, 'specs', 'api'), { recursive: true });
    fs.writeFileSync(path.join(cdir, '.openspec.yaml'), 'schema: agentic-repo-change\nlevel: "L2"\nstatus: "ready_for_impl"\nspecSha: "INITIAL_SHA"\n');
    fs.writeFileSync(path.join(cdir, 'proposal.md'), '# Proposal: Initial\n');
    fs.writeFileSync(path.join(cdir, 'tasks.md'), '# Tasks\n- [x] 1.1 [TEST] verify: ok\n- [x] 1.2 [IMPL] evidence: ok\n');
    fs.writeFileSync(path.join(cdir, 'specs', 'api', 'spec.md'), '# Spec\n');

    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'approved spec commit'], { cwd: repo });
    const approvedSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

    // Update specSha to match approved commit
    fs.writeFileSync(path.join(cdir, '.openspec.yaml'), `schema: agentic-repo-change\nlevel: "L2"\nstatus: "ready_for_impl"\nspecSha: "${approvedSha}"\n`);
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'record specSha'], { cwd: repo });

    // Switch to impl branch
    execFileSync('git', ['checkout', '-b', `impl/${slug}`], { cwd: repo });

    // Add source code and legitimate test
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'test'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'api.js'), 'export const api = true;\n');
    fs.writeFileSync(path.join(repo, 'test', 'api.test.js'), 'export const testApi = true;\n');

    // SNEAKY TAMPER: Author modifies locked proposal.md in working tree WITHOUT running git commit!
    fs.writeFileSync(path.join(cdir, 'proposal.md'), '# Proposal: Tampered Requirements in Working Tree!\n');

    // Run asdlc pr -- staging must commit working tree changes FIRST, causing runVerify to detect spec-tamper!
    await assert.rejects(async () => {
      await prMod.createPR(slug, 'main', { repoRoot: repo, skipOpenspec: true, skipExternal: true });
    }, /implementation verification failed/i);

    // Verify that the branch commit log includes the auto-staged changes
    const lastCommitMsg = execFileSync('git', ['log', '-1', '--pretty=%B'], { cwd: repo, encoding: 'utf8' }).trim();
    assert.match(lastCommitMsg, /impl\(tamper-in-working-tree\): implement verified changes/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('PE Finding 3: asdlc archive --merged protects newly merged Spec PRs without tasks.md from premature deletion', () => {
  const repo = tmpGitRepo('asdlc-archive-protect-');
  try {
    const slugInFlight = 'l2-spec-only-merged';
    const cdirInFlight = path.join(repo, 'openspec', 'changes', slugInFlight);
    fs.mkdirSync(path.join(cdirInFlight, 'specs', 'auth'), { recursive: true });
    fs.writeFileSync(path.join(cdirInFlight, '.openspec.yaml'), 'schema: agentic-repo-change\nlevel: "L2"\nstatus: "ready_for_impl"\n');
    fs.writeFileSync(path.join(cdirInFlight, 'proposal.md'), '# Proposal\n');
    fs.writeFileSync(path.join(cdirInFlight, 'specs', 'auth', 'spec.md'), '# Spec\n');
    // Notice: tasks.md does NOT exist on main yet!

    const slugComplete = 'l1-feature-fully-done';
    const cdirComplete = path.join(repo, 'openspec', 'changes', slugComplete);
    fs.mkdirSync(path.join(cdirComplete, 'specs', 'util'), { recursive: true });
    fs.writeFileSync(path.join(cdirComplete, '.openspec.yaml'), 'schema: agentic-repo-change\nlevel: "L1"\nstatus: "ready_for_impl"\n');
    fs.writeFileSync(path.join(cdirComplete, 'proposal.md'), '# Proposal\n');
    fs.writeFileSync(path.join(cdirComplete, 'specs', 'util', 'spec.md'), '# Spec\n');
    fs.writeFileSync(path.join(cdirComplete, 'tasks.md'), '# Tasks\n- [x] 1.1 Done (AC1) verify: test/util.test.js\n');

    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'merge both changes to main'], { cwd: repo });

    const exitCode = archiveMod.archiveMergedChanges({ repoRoot: repo, targetBranch: 'main' });
    assert.equal(exitCode, 0, 'archiveMergedChanges should exit with code 0 on success');

    // In-flight spec MUST be preserved!
    assert.ok(fs.existsSync(cdirInFlight), 'In-flight L2 spec PR without tasks.md MUST NOT be deleted by archive --merged');
    // Completed feature must be moved to archive
    assert.ok(!fs.existsSync(cdirComplete), 'Fully completed change must be archived');
    const archiveFiles = fs.readdirSync(path.join(repo, 'openspec', 'changes', 'archive'));
    assert.ok(archiveFiles.some((f) => f.includes(slugComplete)), 'Archived directory must exist under archive/');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('PE Finding 4: mixed Chinese-English slugs combine domain tokens, and Invariant 4 blocks code mutations masked with doc words', () => {
  // 1. Mixed Chinese-English slug generation
  const slug1 = deriveChangeSlug('修复微信支付 V3 回调逻辑');
  assert.ok(slug1.includes('wechat') && slug1.includes('payment') && slug1.includes('callback') && slug1.includes('v3'),
    `Slug1 expected rich mixed tokens, got: ${slug1}`);

  const slug2 = deriveChangeSlug('重构清结算 RPC 接口');
  assert.ok(slug2.includes('settlement') && slug2.includes('rpc') && slug2.includes('api'),
    `Slug2 expected rich mixed tokens, got: ${slug2}`);

  // 2. Invariant 4: "重构订单状态机并补充注释" cannot be downgraded to L0 by claiming is_pure_doc
  const assessed = assess({
    stage: 'new',
    requirement: '重构订单状态机并补充注释',
    agentContext: {
      is_pure_doc: true,
      is_pure_test: false,
      classification: 'doc_only',
      rationale: 'Agent claims doc only because of comments'
    },
    persist: false
  });
  assert.notEqual(assessed.risk.level, 'L0', 'Substantive code refactoring cannot be downgraded to L0 even if doc words are present');

  // 3. Offline heuristic baseline recognizes Chinese pure doc intent as L0
  const docAssess = assess({
    stage: 'new',
    requirement: '修复 README 错别字与说明文档',
    persist: false
  });
  assert.equal(docAssess.risk.level, 'L0', 'Pure Chinese doc/typo fix must be evaluated as L0 in offline heuristic baseline');
});

test('PE P2 Nits: verify --json rendering, truth-table bypass prevention, and target branch tasks isolation', () => {
  // Nit 1: verify --json outputs parseable JSON with verdict, pass, results
  const repo = tmpGitRepo('asdlc-p2-verify-json-');
  try {
    const slug = 'test-json-verify';
    const cdir = path.join(repo, 'openspec', 'changes', slug);
    fs.mkdirSync(path.join(cdir, 'specs', slug), { recursive: true });
    fs.mkdirSync(path.join(repo, 'test'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'test', 'x.test.js'), '// test\n');
    fs.writeFileSync(path.join(cdir, 'proposal.md'), '# Proposal\n');
    fs.writeFileSync(path.join(cdir, 'specs', slug, 'spec.md'),
      '# Spec Delta\n\n## Purpose\nThis capability provides verifiable JSON output for verification suites.\n\n## ADDED Requirements\n\n### Requirement: Demo\nThe system SHALL work.\n\n#### Scenario: Work\n- **GIVEN** a\n- **WHEN** b\n- **THEN** c\n\n**Acceptance criteria**\n- [ ] AC1: works (test: test/x.test.js)\n\n## Constraints & NFRs\n\n## Out of Scope\n\n## Test Strategy\nUnit test verifies JSON output.\n');
    fs.writeFileSync(path.join(cdir, 'tasks.md'), '- [x] 1.1 Done (AC1) verify: test/x.test.js\n');
    fs.writeFileSync(path.join(cdir, '.openspec.yaml'), 'schema: agentic-repo-change\nlevel: "L0"\nstatus: "ready_for_impl"\n');

    let printed = '';
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk) => {
      printed += chunk;
      return true;
    };
    try {
      const code = runVerify(slug, { repoRoot: repo, base: 'HEAD', head: 'HEAD', json: true, skipOpenspec: true });
      assert.equal(code, 0, 'verify --json should exit with 0 when checks pass');
      const parsed = JSON.parse(printed.trim());
      assert.equal(parsed.verdict, 'PASS');
      assert.equal(parsed.pass, true);
      assert.ok(Array.isArray(parsed.results));
      assert.ok(parsed.results.length > 0);
    } finally {
      process.stdout.write = origWrite;
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }

  // Nit 2: Adversarial bypass where both is_pure_doc AND is_pure_test are set to true
  const doubleClaimAssess = assess({
    stage: 'new',
    requirement: '重构订单状态机并补充注释',
    agentContext: {
      is_pure_doc: true,
      is_pure_test: true,
      classification: 'doc_only',
      rationale: 'Adversarial attempt to evade checks by setting both doc and test to true'
    },
    persist: false
  });
  assert.notEqual(doubleClaimAssess.risk.level, 'L0', 'Truth-table bypass: Setting both pure_doc and pure_test must still reject code refactoring');

  // Nit 3: Cross-branch isolation in isChangeMergedAndComplete
  const repo2 = tmpGitRepo('asdlc-p2-target-iso-');
  try {
    const slug = 'feature-in-flight';
    const cdir = path.join(repo2, 'openspec', 'changes', slug);
    fs.mkdirSync(path.join(cdir, 'specs', 'api'), { recursive: true });
    fs.writeFileSync(path.join(cdir, '.openspec.yaml'), 'schema: agentic-repo-change\nlevel: "L2"\nstatus: "ready_for_impl"\n');
    fs.writeFileSync(path.join(cdir, 'proposal.md'), '# Proposal\n');
    fs.writeFileSync(path.join(cdir, 'specs', 'api', 'spec.md'), '# Spec\n');

    // Commit only the Spec PR to main (tasks.md does NOT exist on main!)
    execFileSync('git', ['add', '-A'], { cwd: repo2 });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'merge spec to main'], { cwd: repo2 });

    // Now developer checks out a feature branch and creates tasks.md locally
    execFileSync('git', ['checkout', '-b', 'feat/impl'], { cwd: repo2 });
    fs.writeFileSync(path.join(cdir, 'tasks.md'), '- [x] 1.1 Local checked task (AC1)\n');

    // On main, tasks.md does NOT exist. Local working-tree tasks MUST NOT leak into main check!
    const isCompleteOnMain = archiveMod.isChangeMergedAndComplete(repo2, slug, 'main');
    assert.equal(isCompleteOnMain, false, 'Working tree tasks.md must not leak into target branch check');

    // But on the feature branch (HEAD), it is complete once committed
    execFileSync('git', ['add', path.join(cdir, 'tasks.md')], { cwd: repo2 });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'add tasks on feat'], { cwd: repo2 });
    const isCompleteOnFeat = archiveMod.isChangeMergedAndComplete(repo2, slug, 'HEAD');
    assert.equal(isCompleteOnFeat, true, 'Tasks committed on current branch should be recognized on HEAD');
  } finally {
    fs.rmSync(repo2, { recursive: true, force: true });
  }
});


