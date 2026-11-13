import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  CONTAINER_SECURITY_BASELINE,
  buildDockerCreateArgs,
  detectRepoLifecycle,
  lockSpecsReadOnly,
  preScanWorkspaceForSecrets,
  unlockSpecsWritable,
} from '../src/lib/container.js';
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
    assert.equal(brokenFix.exitCode, 0);

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
