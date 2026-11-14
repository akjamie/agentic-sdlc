import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  CONTAINER_SECURITY_BASELINE,
  DEFAULT_RUNNER_IMAGE,
  SUPPORTED_CONTAINER_ENGINES,
  buildContainerCreateArgs,
  buildDockerCreateArgs,
  checkContainerEngineHealth,
  detectRepoLifecycle,
  isEngineAvailable,
  lockContainerSpecsRootReadOnly,
  lockSpecsReadOnly,
  preScanWorkspaceForSecrets,
  resolveContainerEngine,
  runContainerPipeline,
  stageWorkspaceToContainer,
  syncContainerEgressToHost,
  unlockSpecsWritable,
} from '../src/lib/container.js';
import {
  fetchGitHubPrReviewContext,
  replyAndResolveGitHubThread,
} from '../src/lib/triage.js';
import {
  CANONICAL_STAGES,
  acquireChangeMutex,
  evaluateStateVector,
  normalizeStage,
  releaseChangeMutex,
  runPipeline,
} from '../src/commands/run.js';
import { newChange } from '../src/commands/new.js';
import { mergeChange } from '../src/commands/approve.js';
import { checkTestWeakening } from '../src/commands/verify.js';
import { discoverRepoStack, initRepo } from '../src/commands/init.js';
import { upgradeRunnerImage, resolveRunnerImageTag } from '../src/commands/upgrade.js';

function mkTmp(prefix = 'asdlc-run-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function initGitRepo(dir, { withOpenspec = true } = {}) {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'dev'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'dev@example.com'], { cwd: dir });
  if (withOpenspec) {
    fs.mkdirSync(path.join(dir, 'openspec', 'changes'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.gitignore'), 'graphify-out/\n');
  }
  fs.writeFileSync(path.join(dir, 'README.md'), '# demo\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
}

test('normalizeStage: accepts canonical 3+1 stages and aliases, rejects unknown stages', () => {
  assert.deepEqual(CANONICAL_STAGES, ['spec', 'apply', 'verify', 'fix']);
  assert.equal(normalizeStage('spec'), 'spec');
  assert.equal(normalizeStage('APPLY'), 'apply');
  assert.equal(normalizeStage('spec-review'), 'spec');
  assert.equal(normalizeStage('impl-review'), 'verify');
  assert.equal(normalizeStage('fix-comments'), 'fix');
  assert.equal(normalizeStage(null), null);
  assert.throws(() => normalizeStage('deploy-prod'), (err) => err.code === 'ASDLC_ERR_INVALID_STAGE');
});

test('CONTAINER_SECURITY_BASELINE & buildDockerCreateArgs: enforces UID 10001, dropped caps, proxy/CA, SSH socket, no host bind', () => {
  assert.equal(CONTAINER_SECURITY_BASELINE.user, '10001:10001');
  assert.equal(CONTAINER_SECURITY_BASELINE.capDrop, 'ALL');
  assert.equal(CONTAINER_SECURITY_BASELINE.pidsLimit, '512');

  const args = buildDockerCreateArgs({
    image: 'ghcr.io/akjamie/asdlc-runner:2.0.0',
    hostEnv: {
      HTTP_PROXY: 'http://proxy.corp:8080',
      HTTPS_PROXY: 'http://proxy.corp:8443',
      NO_PROXY: 'localhost,.corp.internal',
      SSL_CERT_FILE: '/etc/corp/ca.pem',
    },
    sshAuthSock: '/tmp/ssh-agent.sock',
    env: { ASDLC_STAGE: 'apply' },
    cmd: ['asdlc', 'run', 'feat-1', '--stage', 'apply'],
  });

  assert.equal(args[0], 'create');
  assert.ok(args.includes('--rm'));
  assert.ok(args.includes('10001:10001'));
  assert.ok(args.includes('--cap-drop=ALL'));
  assert.ok(args.includes('--security-opt=no-new-privileges:true'));
  assert.ok(args.includes('--pids-limit=512'));
  assert.ok(!args.includes('--privileged'));
  assert.ok(args.includes('GIT_CONFIG_COUNT=1'));
  assert.ok(args.includes('GIT_CONFIG_KEY_0=safe.directory'));
  assert.ok(args.includes('GIT_CONFIG_VALUE_0=/workspace'));
  assert.ok(args.includes('HTTP_PROXY=http://proxy.corp:8080'));
  assert.ok(args.includes('SSL_CERT_FILE=/etc/ssl/certs/corporate-ca.crt'));
  assert.ok(args.includes('NODE_EXTRA_CA_CERTS=/etc/ssl/certs/corporate-ca.crt'));
  assert.ok(args.includes('/tmp/ssh-agent.sock:/run/ssh-agent.sock:ro'));
  assert.ok(!args.some((a) => a.includes(':/workspace')));
});

test('detectRepoLifecycle & preScanWorkspaceForSecrets: detects tri-state and blocks plaintext secrets', () => {
  const greenfield = mkTmp('asdlc-gf-');
  const brownfield = mkTmp('asdlc-bf-');
  const established = mkTmp('asdlc-est-');
  try {
    assert.equal(detectRepoLifecycle(greenfield).lifecycle, 'greenfield');

    initGitRepo(brownfield, { withOpenspec: false });
    assert.equal(detectRepoLifecycle(brownfield).lifecycle, 'brownfield');

    initGitRepo(established, { withOpenspec: true });
    assert.equal(detectRepoLifecycle(established).lifecycle, 'established');

    assert.equal(preScanWorkspaceForSecrets(established).clean, true);

    // Plant an untracked plaintext AWS AK
    const leakedAws = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
    fs.writeFileSync(path.join(established, '.env.local'), `AWS_ACCESS_KEY_ID=${leakedAws}\n`);
    assert.throws(
      () => preScanWorkspaceForSecrets(established),
      (err) => err.code === 'ASDLC_ERR_UNCOMMITTED_SECRET' && !err.message.includes(leakedAws)
    );
  } finally {
    fs.rmSync(greenfield, { recursive: true, force: true });
    fs.rmSync(brownfield, { recursive: true, force: true });
    fs.rmSync(established, { recursive: true, force: true });
  }
});

test('evaluateStateVector: deterministically maps 4D invariants across the 10-Phase State Matrix', () => {
  assert.equal(evaluateStateVector({ artifacts: { pSpec: 0 } }).phase, 'SPEC_DRAFT');

  assert.equal(
    evaluateStateVector({ artifacts: { pSpec: 1, nOpen: 2 }, prMetadata: { prLabel: 'needs-clarification', cReplied: 0 } }).phase,
    'SPEC_GRILL_PAUSE'
  );
  assert.equal(
    evaluateStateVector({ artifacts: { pSpec: 1, nOpen: 2 }, prMetadata: { prLabel: 'needs-clarification', cReplied: 1 } }).phase,
    'SPEC_GRILL_RESUME'
  );

  assert.equal(
    evaluateStateVector({ artifacts: { pSpec: 1, nOpen: 0 }, gitLocks: { isSinglePr: false, lTarget: 0 } }).phase,
    'SPEC_REVIEW'
  );
  assert.equal(
    evaluateStateVector({
      artifacts: { pSpec: 1, nOpen: 0, rStage: 'spec', rVerdict: 'APPROVE' },
      gitLocks: { isSinglePr: false, lTarget: 0 },
      prMetadata: { prLabel: 'spec-review', prState: 'OPEN', hFeedback: 0 },
    }).phase,
    'AWAITING_SPEC_MERGE'
  );
  assert.equal(
    evaluateStateVector({
      artifacts: { pSpec: 1, nOpen: 0 },
      gitLocks: { isSinglePr: false, lTarget: 0 },
      prMetadata: { prLabel: 'spec-review', prState: 'OPEN', hFeedback: 1, roundsUsed: 1 },
    }).phase,
    'SPEC_HUMAN_REVIEW_FIX'
  );

  assert.equal(
    evaluateStateVector({ artifacts: { pSpec: 1, nOpen: 0, nTasks: 2, uTasks: 1 }, gitLocks: { lTarget: 1 } }).phase,
    'APPLY_TDD'
  );
  assert.equal(
    evaluateStateVector({ artifacts: { pSpec: 1, nOpen: 0, nTasks: 2, uTasks: 0 }, gitLocks: { lTarget: 1 } }).phase,
    'IMPL_REVIEW_AND_VERIFY'
  );
  assert.equal(
    evaluateStateVector({
      artifacts: { pSpec: 1, nOpen: 0, nTasks: 2, uTasks: 0, rStage: 'impl', rVerdict: 'APPROVE' },
      gitLocks: { lTarget: 1 },
      verifyPassed: true,
    }).phase,
    'OPEN_IMPL_PR'
  );
  assert.equal(
    evaluateStateVector({
      prMetadata: { prLabel: 'impl-review', prState: 'OPEN', hFeedback: 1, roundsUsed: 1 },
    }).phase,
    'IMPL_HUMAN_REVIEW_FIX'
  );
  assert.equal(
    evaluateStateVector({
      prMetadata: { prLabel: 'impl-review', prState: 'OPEN', hFeedback: 1, roundsUsed: 3 },
    }).phase,
    'HUMAN_ARBITRATION_REQUIRED'
  );
});

test('runPipeline: Draft PR clarification pause/resume, spec-first applyGuard, 0444 lock, verify, fix circuit breaker, mutex, dry-run', async () => {
  const repo = mkTmp('asdlc-pipeline-');
  let cdir = null;
  try {
    initGitRepo(repo, { withOpenspec: true });
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/demo.git'], { cwd: repo });

    // 1. Container --dry-run produces hardened baseline & redacted JSON plan
    const origWrite = process.stdout.write.bind(process.stdout);
    let captured = '';
    process.stdout.write = (chunk) => {
      captured += String(chunk);
      return true;
    };
    let dryPlan;
    try {
      dryPlan = await runPipeline('feat-dry', {
        repoRoot: repo,
        stage: 'spec',
        container: true,
        dryRun: true,
        json: true,
        env: { ASDLC_GITHUB_APP_TOKEN: 'ghs_secretDryToken999' },
        model: 'anthropic/claude-opus-4-6',
      });
    } finally {
      process.stdout.write = origWrite;
    }
    assert.equal(dryPlan.dryRun, true);
    assert.equal(dryPlan.lifecycle, 'established');
    assert.ok(dryPlan.dockerArgs.includes('10001:10001'));
    assert.ok(!captured.includes('ghs_secretDryToken999'));

    // 2. Scaffold change with [OPEN] clarification -> Draft PR pause & resume
    const slug = newChange('Add webhook validator', { repoRoot: repo, id: 'hook-1', grill: false, openspec: false, mode: 'spec-first' });
    cdir = path.join(repo, 'openspec', 'changes', slug);
    fs.writeFileSync(path.join(cdir, 'proposal.md'), '# Proposal: Add webhook validator\nValidate signatures.\n');
    fs.writeFileSync(path.join(cdir, 'design.md'), [
      '# Technical Design: Webhook Signature Validator',
      '',
      '## Architecture & Sequence',
      'Incoming webhook payloads are verified using constant-time HMAC SHA-256 comparison against the `X-Hub-Signature-256` request header before dispatching downstream handlers.',
      '',
      '## Security & Failure Mode',
      'Requests missing valid signatures fail closed with HTTP 401 and structured audit logging without leaking secret values.',
    ].join('\n'));
    fs.mkdirSync(path.join(cdir, 'specs', 'webhooks'), { recursive: true });
    const specFile = path.join(cdir, 'specs', 'webhooks', 'spec.md');
    fs.writeFileSync(specFile, [
      '# Webhooks Spec',
      '',
      '## Purpose',
      'Validate HMAC signatures on incoming webhooks.',
      '',
      '## ADDED Requirements',
      '### Requirement: Signature Check',
      'The handler SHALL reject invalid HMAC signatures.',
      '#### Scenario: Bad signature',
      '- **GIVEN** an invalid signature',
      '- **WHEN** webhook arrives',
      '- **THEN** return HTTP 401',
      '- [ ] AC1: Returns 401 on invalid HMAC (test: test/webhook.test.js)',
      '',
      '## Test Strategy',
      'Run webhook unit test.',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(cdir, 'clarifications.md'), '# Clarifications\n\n- [OPEN] Use SHA-256 or SHA-512?\n');

    execFileSync('git', ['checkout', '-qb', `spec/${slug}`], { cwd: repo });

    // Pause when [OPEN] remains and no human reply yet
    const paused = await runPipeline(slug, {
      repoRoot: repo,
      stage: 'spec',
      mode: 'spec-first',
      createDraftPr: async () => ({ draft: true, number: 10 }),
    });
    assert.equal(paused.phase, 'SPEC_GRILL_PAUSE');
    assert.equal(paused.prLabel, 'asdlc:needs-clarification');
    assert.equal(paused.exitCode, 0);

    // Resume when human replies in Draft PR and settles [OPEN]
    const resumed = await runPipeline(slug, {
      repoRoot: repo,
      stage: 'spec',
      mode: 'spec-first',
      skipPush: true,
      skipCliPr: true,
      skipOpenspec: true,
      skipExternal: true,
      whichCommand: () => null,
      env: { ASDLC_GITHUB_APP_TOKEN: 'ghs_specStageToken111' },
      fetchFn: async (url) => {
        if (url.endsWith('/pulls')) {
          return { ok: true, json: async () => ({ number: 11, html_url: 'https://github.com/acme/demo/pull/11' }) };
        }
        return { ok: true, json: async () => ({}) };
      },
      prContext: { cReplied: 1, comments: [{ body: 'Use SHA-256.' }] },
      onResumeClarifications: async ({ cdir: d }) => {
        fs.writeFileSync(path.join(d, 'clarifications.md'), '# Clarifications\n\n- [RESOLVED] Use SHA-256.\n');
      },
    });
    assert.equal(resumed.phase, 'SPEC_REVIEW');
    assert.equal(resumed.lint.pass, true);
    assert.equal(resumed.pr.prUrl, 'https://github.com/acme/demo/pull/11');

    // 3. spec-first MUST block apply before Spec PR merge into main
    await assert.rejects(
      () => runPipeline(slug, { repoRoot: repo, stage: 'apply', mode: 'spec-first' }),
      /not approved yet/
    );

    // Merge Spec PR into main & approve
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'spec pr'], { cwd: repo });
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: repo });
    execFileSync('git', ['merge', '--no-ff', '-qm', 'merge spec', `spec/${slug}`], { cwd: repo });
    mergeChange(slug, { repoRoot: repo, mode: 'spec-first', commit: true, tag: false });

    // 4. apply locks proposal.md & specs/** as 0444 read-only and executes TDD
    execFileSync('git', ['checkout', '-qb', `impl/${slug}`], { cwd: repo });
    fs.writeFileSync(path.join(cdir, 'tasks.md'), '# Tasks\n\n- [ ] Task 1: Validate HMAC (AC1)\n');
    const applyRes = await runPipeline(slug, {
      repoRoot: repo,
      stage: 'apply',
      mode: 'spec-first',
      implExecutor: async () => {
        // Confirm OS read-only lock throws when attempting to mutate spec
        assert.throws(() => fs.writeFileSync(specFile, 'tampered'), (e) => e.code === 'EACCES' || e.code === 'EPERM');
        fs.mkdirSync(path.join(repo, 'test'), { recursive: true });
        fs.writeFileSync(path.join(repo, 'test', 'webhook.test.js'), 'import assert from "node:assert"; assert.ok(true);\n');
        fs.writeFileSync(path.join(cdir, 'tasks.md'), '# Tasks\n\n- [x] Task 1: Validate HMAC (AC1) — _Verify: `node --test test/webhook.test.js`_ (pass)\n');
        return { implemented: true };
      },
    });
    assert.equal(applyRes.phase, 'APPLY_TDD');
    assert.ok(applyRes.lockedSpecPaths.includes(specFile));

    // Commit impl changes & verify -> opens Impl PR
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'impl webhook'], { cwd: repo });
    const verifyRes = await runPipeline(slug, {
      repoRoot: repo,
      stage: 'verify',
      mode: 'spec-first',
      ci: false,
      skipPush: true,
      skipCliPr: true,
      skipOpenspec: true,
      skipExternal: true,
      whichCommand: () => null,
      env: { ASDLC_GITHUB_APP_TOKEN: 'ghs_implStageToken222' },
      fetchFn: async (url) => {
        if (url.endsWith('/pulls')) {
          return { ok: true, json: async () => ({ number: 12, html_url: 'https://github.com/acme/demo/pull/12' }) };
        }
        return { ok: true, json: async () => ({}) };
      },
    });
    assert.equal(verifyRes.verify.pass, true);
    assert.equal(verifyRes.phase, 'OPEN_IMPL_PR');

    // 5. fix stage trips 3-round anti-thrashing circuit breaker cleanly (exitCode 0)
    const brokenFix = await runPipeline('#12', {
      repoRoot: repo,
      stage: 'fix',
      prContext: {
        changeId: slug,
        roundsUsed: 3,
        threads: [{ id: 't1', path: 'src/hook.js', line: 10, isResolved: false, comments: { nodes: [{ body: 'Please refactor', author: { login: 'alice' } }] } }],
      },
    });
    assert.equal(brokenFix.phase, 'HUMAN_ARBITRATION_REQUIRED');
    assert.equal(brokenFix.circuitBroken, true);
    assert.equal(brokenFix.escalationLabel, 'asdlc:needs-human-arbitration');
    assert.equal(brokenFix.exitCode, 2);

    // 6. Per-change mutex prevents concurrent runs on the same change
    const lockPath = acquireChangeMutex(cdir, { stage: 'apply' });
    try {
      assert.throws(() => acquireChangeMutex(cdir, { stage: 'verify' }), (e) => e.code === 'ASDLC_ERR_CHANGE_LOCKED');
    } finally {
      releaseChangeMutex(lockPath);
    }
  } finally {
    if (cdir) {
      unlockSpecsWritable(cdir);
    }
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('Container 3-layer ingestion, egress sync, SSH Patterns A/B/C, init --onboard & upgrade image sync', () => {
  // 1. SSH Patterns A & B/C in buildDockerCreateArgs
  const sshKeyArgs = buildDockerCreateArgs({
    sshKeyPath: '/home/dev/.ssh/id_ed25519',
  });
  assert.ok(sshKeyArgs.some((a) => a.startsWith('GIT_SSH_COMMAND=') && a.includes('/dev/shm/.ssh/id_ed25519') && a.includes('StrictHostKeyChecking=accept-new')));

  const macAgentArgs = buildDockerCreateArgs({
    platform: 'darwin',
    sshAgent: true,
  });
  assert.ok(macAgentArgs.includes('/run/host-services/ssh-auth.sock:/run/host-services/ssh-auth.sock:ro'));
  assert.ok(macAgentArgs.includes('SSH_AUTH_SOCK=/run/host-services/ssh-auth.sock'));

  // 2. 3-layer dirty tree ingestion + /dev/shm streaming + egress sync
  const repo = mkTmp('asdlc-stage-');
  const fakeHome = mkTmp('asdlc-skills-home-');
  const extFile = path.join(fakeHome, 'prd.md');
  try {
    initGitRepo(repo, { withOpenspec: true });
    fs.writeFileSync(path.join(repo, 'README.md'), '# modified tracked\n');
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'hello\n');
    fs.writeFileSync(extFile, '# External PRD\n');
    fs.mkdirSync(path.join(fakeHome, '.asdlc', 'skills', 'jira-custom'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.asdlc', 'skills', 'jira-custom', 'SKILL.md'), '# Jira\n');

    const calls = [];
    const mockExec = (cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === 'git' && args[0] === 'archive') return { status: 0, stdout: Buffer.from('tar') };
      if (cmd === 'git' && args[0] === 'diff') return { status: 0, stdout: 'diff --git a/README.md b/README.md\n+modified' };
      if (cmd === 'git' && args[0] === 'ls-files') return { status: 0, stdout: 'untracked.txt\n' };
      return { status: 0, stdout: '' };
    };

    const stageRes = stageWorkspaceToContainer(repo, 'cid-123456', {
      execFn: mockExec,
      homeDir: fakeHome,
      fromFiles: [extFile],
      sshKeyContent: '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
      harness: {
        generatedConfig: { $schema: 'https://opencode.ai/config.json' },
        authPayload: { anthropic: { type: 'api', key: 'sk-test-1' } },
      },
    });
    assert.ok(stageRes.layers.includes('git-archive-head'));
    assert.ok(stageRes.layers.includes('git-diff-head'));
    assert.ok(stageRes.layers.includes('untracked-files:1'));
    assert.equal(stageRes.externalFiles, 1);
    assert.equal(stageRes.customSkillsInjected, true);
    assert.deepEqual(stageRes.shmCredentials, [
      '/dev/shm/opencode/opencode.json',
      '/dev/shm/opencode/auth.json',
      '/dev/shm/.ssh/id_ed25519',
    ]);

    const egressEst = syncContainerEgressToHost(repo, 'cid-123456', 'established', {
      execFn: mockExec,
      branch: 'impl/demo',
      targetRef: 'impl/demo',
    });
    assert.equal(egressEst.strategy, 'git-bundle-fetch');
    assert.ok(calls.some((c) => c[0] === 'docker' && c.includes('bundle') && c.includes('create')));
    assert.ok(calls.some((c) => c[0] === 'git' && c[1] === 'fetch'));

    // 3. initRepo --headless --onboard stack discovery
    const greenDir = mkTmp('asdlc-onboard-');
    try {
      fs.writeFileSync(path.join(greenDir, 'package.json'), JSON.stringify({
        name: 'demo-app',
        scripts: { test: 'node --test', lint: 'eslint .' },
      }));
      const stack = discoverRepoStack(greenDir);
      assert.ok(stack.languages.includes('javascript/node'));
      assert.equal(stack.testCommand, 'npm test');

      initRepo({ repoRoot: greenDir, headless: true, onboard: true, openspec: false, graph: false });
      assert.ok(fs.existsSync(path.join(greenDir, '.git')));
      assert.match(fs.readFileSync(path.join(greenDir, 'openspec', 'config.yaml'), 'utf8'), /test_command: "npm test"/);
      assert.match(fs.readFileSync(path.join(greenDir, 'AGENTS.md'), 'utf8'), /Test command: `npm test`/);
    } finally {
      fs.rmSync(greenDir, { recursive: true, force: true });
    }

    // 4. upgradeRunnerImage aligns image tag & invokes docker/podman pull
    const tag = resolveRunnerImageTag();
    assert.match(tag, /^ghcr\.io\/akjamie\/asdlc-runner:/);
    const pulled = [];
    const upgRes = upgradeRunnerImage({
      image: 'ghcr.io/akjamie/asdlc-runner:2.0.0-alpha.1',
      execFn: (cmd, args) => {
        pulled.push([cmd, ...args]);
        return { status: 0 };
      },
    });
    assert.equal(upgRes.pulled, true);
    assert.deepEqual(pulled, [
      ['docker', 'info'],
      ['docker', 'pull', 'ghcr.io/akjamie/asdlc-runner:2.0.0-alpha.1'],
    ]);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('Human-centric runPipeline resolution (branch auto-detect, PR label, multi-change guard, pauseBanner) & anti-test-weakening', async () => {
  // 1. checkTestWeakening flags deleted tests and newly introduced .skip(...)
  const deleted = checkTestWeakening(process.cwd(), 'main', 'HEAD', [], {
    nameStatusText: 'D\ttest/important.test.js\nM\tsrc/app.js\n',
    diffText: '',
  });
  assert.equal(deleted.ok, false);
  assert.match(deleted.detail, /deleted test file: test\/important\.test\.js/);

  const skipped = checkTestWeakening(process.cwd(), 'main', 'HEAD', ['test/app.test.js'], {
    nameStatusText: 'M\ttest/app.test.js\n',
    diffText: '+++ b/test/app.test.js\n+  test.skip("flaky check", () => {});\n',
  });
  assert.equal(skipped.ok, false);
  assert.match(skipped.detail, /\.skip\(/);

  const cleanWeak = checkTestWeakening(process.cwd(), 'main', 'HEAD', ['test/app.test.js'], {
    nameStatusText: 'M\ttest/app.test.js\n',
    diffText: '+++ b/test/app.test.js\n+  test("real check", () => { assert.ok(true); });\n',
  });
  assert.equal(cleanWeak.ok, true);

  // 2. Multi-change disambiguation vs active branch auto-detection & pauseBanner
  const repo = mkTmp('asdlc-branch-');
  try {
    initGitRepo(repo, { withOpenspec: true });
    newChange('first task', { repoRoot: repo, id: 'alpha-change', grill: false, openspec: false });
    newChange('second task', { repoRoot: repo, id: 'beta-change', grill: false, openspec: false });

    // On main with 2 active changes -> throws MULTIPLE_ACTIVE_CHANGES
    await assert.rejects(
      () => runPipeline(null, { repoRoot: repo, stage: 'spec', skipPr: true }),
      (e) => e.code === 'MULTIPLE_ACTIVE_CHANGES'
    );

    // Switch to branch `spec/beta-change` -> auto-detects `beta-change` even with 2 active changes
    execFileSync('git', ['checkout', '-qb', 'spec/beta-change'], { cwd: repo });
    const cdirBeta = path.join(repo, 'openspec', 'changes', 'beta-change');
    fs.writeFileSync(path.join(cdirBeta, 'clarifications.md'), '## Open questions\n- [OPEN] Choose backoff strategy?\n');
    const pausedRes = await runPipeline(null, {
      repoRoot: repo,
      stage: 'spec',
      createDraftPr: async () => ({ number: 77 }),
    });
    assert.equal(pausedRes.slug, 'beta-change');
    assert.equal(pausedRes.paused, true);
    assert.match(pausedRes.pauseBanner, /Paused: Awaiting human replies on Draft Spec PR #77/);
    assert.match(pausedRes.pauseBanner, /asdlc run #77/);

    // PR number resolution via label `asdlc:change-id: alpha-change`
    const prDry = await runPipeline('#88', {
      repoRoot: repo,
      container: true,
      dryRun: true,
      prMetadataResolver: async () => ({
        number: 88,
        title: 'Some generic PR title',
        headRefName: 'topic/misc',
        labels: [{ name: 'asdlc:change-id: alpha-change' }, { name: 'asdlc:spec-review' }],
        state: 'OPEN',
      }),
    });
    assert.equal(prDry.slug, 'alpha-change');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('runContainerPipeline & lockContainerSpecsRootReadOnly: validates docker preflight, root locking, lifecycle, and egress', async () => {
  const repo = mkTmp('asdlc-cont-test-');
  try {
    initGitRepo(repo, { withOpenspec: true });
    newChange('container execution test', { repoRoot: repo, id: 'cont-change', grill: false, openspec: false });

    // 1. Container engine preflight failure throws ASDLC_ERR_ENGINE_NOT_AVAILABLE
    await assert.rejects(
      () => runContainerPipeline('cont-change', {
        repoRoot: repo,
        execFn: (cmd, args) => {
          if (cmd === 'docker' || cmd === 'podman') return { status: 1, stderr: `${cmd}: command not found` };
          return { status: 0 };
        },
      }),
      (err) => err.code === 'ASDLC_ERR_ENGINE_NOT_AVAILABLE' || err.code === 'ASDLC_ERR_DOCKER_NOT_AVAILABLE'
    );

    // 2. lockContainerSpecsRootReadOnly executes docker exec -u 0:0 chown and chmod
    const lockCalls = [];
    lockContainerSpecsRootReadOnly('cid-abc', 'cont-change', {
      execFn: (cmd, args) => {
        lockCalls.push([cmd, ...args]);
        return { status: 0 };
      },
    });
    assert.equal(lockCalls.length, 2);
    assert.equal(lockCalls[0][0], 'docker');
    assert.ok(lockCalls[0].includes('-u'));
    assert.ok(lockCalls[0].includes('0:0'));
    assert.ok(lockCalls[0].some((a) => String(a).includes('chown -R 0:0') && String(a).includes('chmod -R 0444')));

    // 3. Full container pipeline lifecycle execution
    const containerCalls = [];
    const runRes = await runContainerPipeline('cont-change', {
      repoRoot: repo,
      stage: 'apply',
      slug: 'cont-change',
      execFn: (cmd, args) => {
        containerCalls.push([cmd, ...args]);
        if (cmd === 'docker' && args[0] === '--version') return { status: 0, stdout: 'Docker version 27.0.0' };
        if (cmd === 'docker' && args[0] === 'create') return { status: 0, stdout: 'cid-mock-99999\n' };
        if (cmd === 'docker' && args[0] === 'start') return { status: 0, stdout: 'pipeline completed' };
        if (cmd === 'docker' && args[0] === 'rm') return { status: 0 };
        if (cmd === 'docker' && args[0] === 'exec') return { status: 0 };
        if (cmd === 'docker' && args[0] === 'cp') return { status: 0 };
        if (cmd === 'git') return { status: 0, stdout: '' };
        return { status: 0 };
      },
    });

    assert.equal(runRes.containerId, 'cid-mock-99999');
    assert.equal(runRes.exitCode, 0);
    assert.ok(containerCalls.some((c) => c[0] === 'docker' && (c[1] === '--version' || c[1] === 'info')));
    assert.ok(containerCalls.some((c) => c[0] === 'docker' && c[1] === 'create'));
    assert.ok(containerCalls.some((c) => c[0] === 'docker' && c[1] === 'start' && c[2] === 'cid-mock-99999'));
    assert.ok(containerCalls.some((c) => c[0] === 'docker' && c[1] === 'exec' && c.includes('0:0')));
    assert.ok(containerCalls.some((c) => c[0] === 'docker' && c[1] === 'exec' && c.some((a) => String(a).includes('asdlc'))));
    assert.ok(containerCalls.some((c) => c[0] === 'docker' && c[1] === 'rm' && c[2] === '-f'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('PR error handling and triage GraphQL I/O defaults', async () => {
  const repo = mkTmp('asdlc-pr-test-');
  try {
    initGitRepo(repo, { withOpenspec: true });

    // 1. Missing or unresolvable PR number fails fast with ASDLC_ERR_PR_NOT_FOUND
    await assert.rejects(
      () => runPipeline('#999', {
        repoRoot: repo,
        prMetadataResolver: async () => null,
      }),
      (err) => err.code === 'ASDLC_ERR_PR_NOT_FOUND'
    );

    // 2. fetchGitHubPrReviewContext: parses GraphQL PR review threads and comments
    const mockGqlPayload = {
      data: {
        repository: {
          pullRequest: {
            headRefOid: 'abc1234',
            reviewDecision: 'CHANGES_REQUESTED',
            reviewThreads: {
              nodes: [
                {
                  id: 'THREAD_1',
                  isResolved: false,
                  path: 'src/app.js',
                  line: 42,
                  comments: {
                    nodes: [
                      {
                        id: 'COMMENT_1',
                        body: '```suggestion\nconst fixed = true;\n```',
                        author: { login: 'reviewer-alice' },
                        createdAt: '2026-11-13T00:00:00Z',
                      },
                    ],
                  },
                },
                {
                  id: 'THREAD_BOT',
                  isResolved: false,
                  path: 'src/app.js',
                  line: 10,
                  comments: {
                    nodes: [
                      {
                        id: 'COMMENT_BOT',
                        body: 'Automated scan finished',
                        author: { login: 'codecov[bot]' },
                        createdAt: '2026-11-13T00:00:00Z',
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    };

    const ctx = await fetchGitHubPrReviewContext(42, {
      repoRoot: repo,
      repo: 'https://github.com/acme/repo.git',
      fetchFn: async () => ({
        ok: true,
        json: async () => mockGqlPayload,
      }),
    });

    assert.equal(ctx.prNumber, 42);
    assert.equal(ctx.reviewDecision, 'CHANGES_REQUESTED');
    assert.equal(ctx.reviewThreads.length, 2);

    // 3. replyAndResolveGitHubThread executes GraphQL mutation
    const mutationCalls = [];
    const repRes = await replyAndResolveGitHubThread({
      threadId: 'THREAD_1',
      replyBody: 'Applied suggestion in commit abc',
      resolve: true,
      repoRoot: repo,
      ghRunner: (cmd, args) => {
        mutationCalls.push([cmd, ...args]);
        return {
          status: 0,
          stdout: JSON.stringify({
            data: {
              addPullRequestReviewThreadReply: { comment: { id: 'NEW_C' } },
              resolveReviewThread: { thread: { isResolved: true } },
            },
          }),
        };
      },
    });

    assert.equal(repRes.replied, true);
    assert.equal(repRes.resolved, true);
    assert.equal(mutationCalls.length, 2);
    assert.ok(mutationCalls[0].some((a) => a.includes('addPullRequestReviewThreadReply')));
    assert.ok(mutationCalls[1].some((a) => a.includes('resolveReviewThread')));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('Stub Docker daemon simulation: enforces realistic daemon state machine (exec only on running, tmpfs only after start, egress before rm)', async () => {
  const repo = mkTmp('asdlc-stub-docker-');
  try {
    initGitRepo(repo, { withOpenspec: true });
    newChange('stub docker validation', { repoRoot: repo, id: 'stub-change', grill: false, openspec: false });

    // Realistic state machine tracking container lifecycle
    let containerState = 'none'; // 'none' | 'created' | 'running' | 'removed'
    const execLog = [];

    const stubDockerExec = (cmd, args) => {
      execLog.push([cmd, ...args]);
      if (cmd === 'docker') {
        const sub = args[0];
        if (sub === '--version') return { status: 0, stdout: 'Docker version 27.0.0' };
        if (sub === 'create') {
          containerState = 'created';
          return { status: 0, stdout: 'cid-daemon-real\n' };
        }
        if (sub === 'start') {
          if (containerState !== 'created') {
            return { status: 1, stderr: `Error response from daemon: Container is in state ${containerState}` };
          }
          containerState = 'running';
          return { status: 0 };
        }
        if (sub === 'exec') {
          // Docker strictly requires running state for exec
          if (containerState !== 'running') {
            return { status: 1, stderr: `Error response from daemon: Container is not running (state: ${containerState})` };
          }
          return { status: 0 };
        }
        if (sub === 'cp') {
          if (containerState === 'removed') {
            return { status: 1, stderr: 'Error response from daemon: No such container' };
          }
          return { status: 0 };
        }
        if (sub === 'rm') {
          containerState = 'removed';
          return { status: 0 };
        }
      }
      if (cmd === 'git') return { status: 0, stdout: '' };
      return { status: 0 };
    };

    const res = await runContainerPipeline('stub-change', {
      repoRoot: repo,
      stage: 'apply',
      slug: 'stub-change',
      execFn: stubDockerExec,
    });

    assert.equal(res.exitCode, 0);
    assert.equal(containerState, 'removed');
    // Ensure that no 'exec' was ever run while state was 'created'
    const createIndex = execLog.findIndex((c) => c[0] === 'docker' && c[1] === 'create');
    const startIndex = execLog.findIndex((c) => c[0] === 'docker' && c[1] === 'start');
    const firstExecIndex = execLog.findIndex((c) => c[0] === 'docker' && c[1] === 'exec');

    assert.ok(createIndex >= 0 && startIndex > createIndex, 'start must follow create');
    assert.ok(firstExecIndex > startIndex, 'all docker exec calls must happen after docker start');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('Product integrity: autonomous mode fails fast without agents and fix stage protects review feedback', async () => {
  const repo = mkTmp('asdlc-integrity-test-');
  try {
    initGitRepo(repo, { withOpenspec: true });
    newChange('integrity test change', { repoRoot: repo, id: 'integ-change', grill: false, openspec: false });
    const cdir = path.join(repo, 'openspec', 'changes', 'integ-change');
    fs.writeFileSync(path.join(cdir, 'proposal.md'), '# Proposal: Integrity Change\nProvide robust integrity checks.\n');
    fs.writeFileSync(path.join(cdir, 'design.md'), '# Technical Design\n\n## Architecture & Sequence\nIncoming payloads are verified using constant-time HMAC comparison.\n\n## Security\nMissing signatures fail closed.\n');
    fs.mkdirSync(path.join(cdir, 'specs', 'cap'), { recursive: true });
    fs.writeFileSync(path.join(cdir, 'specs', 'cap', 'spec.md'), [
      '# Spec',
      '',
      '## Purpose',
      'Validate HMAC signatures on incoming requests.',
      '',
      '## ADDED Requirements',
      '### Requirement: One',
      'The service SHALL validate incoming signatures.',
      '#### Scenario: S1',
      '- **GIVEN** valid payload',
      '- **WHEN** received',
      '- **THEN** return 200',
      '- [ ] AC1: test check (test: test/a.test.js)',
      '',
      '## Test Strategy',
      'Execute unit test suite.',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(cdir, 'clarifications.md'), '# Clarifications\n- [SETTLED] All settled\n');

    // 1. Mandatory agent mode (container/CI/explicit -m) without agent CLI fails fast with ASDLC_ERR_AGENT_UNAVAILABLE
    await assert.rejects(
      () => runPipeline('integ-change', {
        repoRoot: repo,
        stage: 'spec',
        model: 'anthropic/claude-sonnet-4-5',
        whichCommand: () => null,
      }),
      (err) => err.code === 'ASDLC_ERR_AGENT_UNAVAILABLE'
    );

    // 1.1 In CI/container environment (process.env.CI='true') without agent CLI also fails fast
    await assert.rejects(
      () => runPipeline('integ-change', {
        repoRoot: repo,
        stage: 'spec',
        ci: true,
        whichCommand: () => null,
      }),
      (err) => err.code === 'ASDLC_ERR_AGENT_UNAVAILABLE'
    );

    // 2. Local manual run without agent CLI gracefully degrades to deterministic gates (no fake passes)
    const manualSpec = await runPipeline('integ-change', {
      repoRoot: repo,
      stage: 'spec',
      ci: false,
      skipPr: true,
      whichCommand: () => null,
    });
    assert.equal(manualSpec.review.status, 'skipped');
    assert.match(manualSpec.review.summary, /Local AI CLI \(opencode\) not found in PATH/);

    // 3. Fix stage preserves Category C questions and leaves threads open if no fix commit was created
    const fixResNoCommit = await runPipeline('integ-change', {
      repoRoot: repo,
      stage: 'fix',
      ci: false,
      whichCommand: () => null,
      prContext: {
        changeId: 'integ-change',
        threads: [
          { id: 'T_ACTION', path: 'src/a.js', line: 1, isResolved: false, comments: { nodes: [{ body: 'Fix this bug', author: { login: 'reviewer' } }] } },
          { id: 'T_QUESTION', path: 'src/a.js', line: 2, isResolved: false, comments: { nodes: [{ body: 'Why did we use float here?', author: { login: 'reviewer' } }] } },
        ],
      },
    });

    assert.equal(fixResNoCommit.unresolvedQuestions, 1, 'Category C question preserved for human');
    assert.equal(fixResNoCommit.resolvedThreads.length, 0, 'No threads resolved without a verified fix commit');
    assert.equal(fixResNoCommit.fixOutput.status, 'plan_generated');

    // 4. Fix stage resolves only when verified commitSha is produced
    const repliesSent = [];
    const fixResWithCommit = await runPipeline('integ-change', {
      repoRoot: repo,
      stage: 'fix',
      ci: false,
      commitSha: 'c0ffee1234567890',
      whichCommand: () => null,
      fetchPrContext: async () => ({
        reviewThreads: [
          { id: 'T_ACTION', path: 'src/a.js', line: 1, isResolved: false, comments: { nodes: [{ body: 'Fix this bug', author: { login: 'reviewer' } }] } },
          { id: 'T_QUESTION', path: 'src/a.js', line: 2, isResolved: false, comments: { nodes: [{ body: 'Why did we use float here?', author: { login: 'reviewer' } }] } },
        ],
      }),
      fixExecutor: async ({ plan }) => ({ ok: true, commitSha: 'c0ffee1234567890' }),
      ghRunner: (cmd, args) => {
        repliesSent.push([cmd, ...args]);
        return { status: 0, stdout: JSON.stringify({ data: { addPullRequestReviewThreadReply: { comment: { id: 'C1' } }, resolveReviewThread: { thread: { isResolved: true } } } }) };
      },
    });

    assert.equal(fixResWithCommit.unresolvedQuestions, 1, 'Category C question remained open');
    assert.equal(fixResWithCommit.resolvedThreads.length, 1, 'Only Category A actionable thread was resolved');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('Container Engine Abstraction: resolveContainerEngine, Podman execution, and health reporting', async () => {
  assert.deepEqual(SUPPORTED_CONTAINER_ENGINES, ['docker', 'podman']);

  // 1. Explicit CLI selection
  const dockerExplicit = resolveContainerEngine({ engine: 'docker' }, (cmd) => ({ status: 0 }));
  assert.equal(dockerExplicit, 'docker');

  const podmanExplicit = resolveContainerEngine({ engine: 'podman' }, (cmd) => ({ status: 0 }));
  assert.equal(podmanExplicit, 'podman');

  // 2. Reject unsupported engines with ASDLC_ERR_INVALID_ENGINE
  assert.throws(
    () => resolveContainerEngine({ engine: 'nerdctl' }),
    (err) => err.code === 'ASDLC_ERR_INVALID_ENGINE' && err.message.includes('nerdctl')
  );
  assert.throws(
    () => resolveContainerEngine({ engine: 'kubernetes' }),
    (err) => err.code === 'ASDLC_ERR_INVALID_ENGINE'
  );

  // 3. Fallback / auto detection order: probes docker first, then podman
  const probeCalls = [];
  const autoResolved = resolveContainerEngine({}, (cmd, args) => {
    probeCalls.push(cmd);
    if (cmd === 'docker') return { status: 1 }; // docker not available
    if (cmd === 'podman') return { status: 0 }; // podman available
    return { status: 1 };
  });
  assert.equal(autoResolved, 'podman');
  assert.ok(probeCalls.includes('docker') && probeCalls.includes('podman'));

  // 4. When neither is available, fails closed with ASDLC_ERR_ENGINE_NOT_AVAILABLE
  assert.throws(
    () => resolveContainerEngine({}, () => ({ status: 1 })),
    (err) => err.code === 'ASDLC_ERR_ENGINE_NOT_AVAILABLE'
  );

  // 5. buildContainerCreateArgs differences: SELinux mount options on Podman vs Docker
  const podmanLinuxArgs = buildContainerCreateArgs({
    engine: 'podman',
    platform: 'linux',
    sshAuthSock: '/tmp/ssh.sock',
  });
  assert.ok(podmanLinuxArgs.some((a) => a === '/tmp/ssh.sock:/run/ssh-agent.sock:ro,z'));

  const dockerMacArgs = buildContainerCreateArgs({
    engine: 'docker',
    platform: 'darwin',
    sshAgent: true,
  });
  assert.ok(dockerMacArgs.some((a) => a.includes('/run/host-services/ssh-auth.sock')));

  // 6. Doctor health checks
  const healthPass = checkContainerEngineHealth((cmd, args) => {
    if (cmd === 'podman' && args[0] === '--version') return { status: 0, stdout: 'podman version 5.0.0' };
    if (cmd === 'podman' && args[0] === 'info') return { status: 0 };
    return { status: 1 };
  });
  assert.equal(healthPass.status, 'pass');
  assert.ok(healthPass.detail.includes('podman'));

  const healthWarn = checkContainerEngineHealth((cmd, args) => {
    if (cmd === 'docker' && args[0] === '--version') return { status: 0, stdout: 'Docker version 27.1.0' };
    if (cmd === 'docker' && args[0] === 'info') return { status: 1 }; // daemon down
    return { status: 1 };
  });
  assert.equal(healthWarn.status, 'warn');
  assert.ok(healthWarn.detail.includes('daemon/machine unreachable'));
});

test('Podman lifecycle execution: obeys create -> start -> exec -> egress -> rm using podman CLI', async () => {
  const repo = mkTmp('asdlc-podman-test-');
  try {
    initGitRepo(repo, { withOpenspec: true });
    newChange('podman test change', { repoRoot: repo, id: 'podman-change', grill: false, openspec: false });

    const podmanCalls = [];
    let containerState = 'none';

    const stubPodmanExec = (cmd, args, opts = {}) => {
      podmanCalls.push([cmd, ...args]);
      if (cmd === 'podman') {
        const sub = args[0];
        if (sub === 'info' || sub === '--version') return { status: 0, stdout: 'podman version 5.0.0' };
        if (sub === 'create') {
          containerState = 'created';
          return { status: 0, stdout: 'podman-cid-777\n' };
        }
        if (sub === 'start') {
          assert.equal(containerState, 'created', 'podman start must be called on created container');
          containerState = 'running';
          return { status: 0 };
        }
        if (sub === 'exec') {
          assert.equal(containerState, 'running', 'podman exec is strictly forbidden on non-running container');
          return { status: 0, stdout: 'success' };
        }
        if (sub === 'cp') {
          return { status: 0 };
        }
        if (sub === 'rm') {
          containerState = 'removed';
          return { status: 0 };
        }
      }
      if (cmd === 'git') return { status: 0, stdout: '' };
      return { status: 0 };
    };

    const res = await runContainerPipeline('podman-change', {
      engine: 'podman',
      repoRoot: repo,
      stage: 'apply',
      slug: 'podman-change',
      execFn: stubPodmanExec,
    });

    assert.equal(res.engine, 'podman');
    assert.equal(res.exitCode, 0);
    assert.equal(containerState, 'removed');
    assert.ok(podmanCalls.every((c) => c[0] === 'podman' || c[0] === 'git'));
    assert.ok(podmanCalls.some((c) => c[0] === 'podman' && c[1] === 'create'));
    assert.ok(podmanCalls.some((c) => c[0] === 'podman' && c[1] === 'start'));
    assert.ok(podmanCalls.some((c) => c[0] === 'podman' && c[1] === 'exec'));
    assert.ok(podmanCalls.some((c) => c[0] === 'podman' && c[1] === 'rm'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
