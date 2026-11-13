import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  mintGitHubAppJwt,
  resolveGitCredentials,
  buildEphemeralGitEnv,
  formatBotCommitMessage,
  redactSecrets,
  resolveAgentHarnessConfig,
} from '../src/lib/auth.js';
import { importAgentConfigTemplate } from '../src/commands/config.js';
import { createPR } from '../src/commands/pr.js';
import { newChange } from '../src/commands/new.js';
import { mergeChange } from '../src/commands/approve.js';

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('mintGitHubAppJwt: mints valid RS256 signed JWT verifiable with public key', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const jwt = mintGitHubAppJwt('123456', privateKey, { nowSec: 1700000000 });
  const parts = jwt.split('.');
  assert.equal(parts.length, 3);

  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  assert.equal(payload.iss, '123456');
  assert.equal(payload.iat, 1700000000 - 60);
  assert.equal(payload.exp, 1700000000 + 540);

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();
  assert.equal(verifier.verify(publicKey, Buffer.from(parts[2], 'base64url')), true);
});

test('resolveGitCredentials: enforces priority chain (GitHub App > GitLab Token > Scoped PAT > Developer Keychain)', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // 1. GitHub App token exchange wins over PAT and GitLab token
  let exchangeUrl = null;
  const appCred = await resolveGitCredentials({
    env: {
      ASDLC_GITHUB_APP_ID: '9911',
      ASDLC_GITHUB_APP_INSTALLATION_ID: '5544',
      ASDLC_GITHUB_APP_PRIVATE_KEY: privateKey,
      GH_TOKEN: 'ghp_lowpriority123456',
      GITLAB_TOKEN: 'glpat-lowpriority123',
    },
    fetchFn: async (url, init) => {
      exchangeUrl = url;
      assert.match(init.headers.Authorization, /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      return { ok: true, json: async () => ({ token: 'ghs_installationToken9999' }) };
    },
  });
  assert.equal(appCred.type, 'github-app');
  assert.equal(appCred.token, 'ghs_installationToken9999');
  assert.equal(appCred.triggersCi, true);
  assert.equal(exchangeUrl, 'https://api.github.com/app/installations/5544/access_tokens');

  // 2. GitLab Project Access Token wins over Scoped PAT when App absent
  const glCred = await resolveGitCredentials({
    env: { ASDLC_GITLAB_TOKEN: 'glpat-projecttoken9876', GH_TOKEN: 'ghp_fallback123456' },
    host: 'gitlab.corp.company.com',
  });
  assert.equal(glCred.type, 'gitlab-project-token');
  assert.equal(glCred.username, 'oauth2');
  assert.equal(glCred.token, 'glpat-projecttoken9876');

  // 3. Scoped PAT wins over developer keychain
  const patCred = await resolveGitCredentials({
    env: { ASDLC_GIT_TOKEN: 'github_pat_scopedToken8888' },
    execFn: () => 'gho_keychainIgnored',
  });
  assert.equal(patCred.type, 'scoped-pat');
  assert.equal(patCred.token, 'github_pat_scopedToken8888');

  // 4. Developer CLI Keychain fallback
  const kcCred = await resolveGitCredentials({
    env: {},
    host: 'github.corp.example.com',
    execFn: (cmd, args) => {
      assert.equal(cmd, 'gh');
      assert.deepEqual(args, ['auth', 'token', '--hostname', 'github.corp.example.com']);
      return 'gho_keychainResolved5555\n';
    },
  });
  assert.equal(kcCred.type, 'developer-keychain');
  assert.equal(kcCred.token, 'gho_keychainResolved5555');
});

test('buildEphemeralGitEnv & formatBotCommitMessage: sets in-memory credential helper without mutating disk', () => {
  const env = buildEphemeralGitEnv({
    provider: 'github',
    token: 'ghs_secret_12345',
    username: 'x-access-token',
  }, { PATH: '/usr/bin' });

  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.GH_TOKEN, 'ghs_secret_12345');
  assert.equal(env.GIT_CONFIG_COUNT, '1');
  assert.equal(env.GIT_CONFIG_KEY_0, 'credential.helper');
  assert.match(env.GIT_CONFIG_VALUE_0, /username=x-access-token/);

  const commitMsg = formatBotCommitMessage('feat(auth): add token validation', {
    coAuthorName: 'Alice Engineer',
    coAuthorEmail: 'alice@example.com',
  });
  assert.match(commitMsg, /Co-authored-by: Alice Engineer <alice@example\.com>/);
});

test('redactSecrets: scrubs PATs, GitHub App tokens, GitLab tokens, Anthropic keys, PEM keys, URL basic auth, and explicit values', () => {
  const sample = [
    'GH=ghp_1234567890abcdefghij',
    'APP=ghs_abcdefghijklmnop9988',
    'GL=glpat-supersecrettoken4321',
    'ANT=sk-ant-api03-verysecretkey1234',
    'URL=https://alice:my-top-secret@git.corp.com/org/repo.git',
    'CUSTOM=corp-custom-secret-xyz9',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----',
  ].join('\n');

  const clean = redactSecrets(sample, ['corp-custom-secret-xyz9']);
  assert.doesNotMatch(clean, /1234567890/);
  assert.doesNotMatch(clean, /abcdefghijklmnop/);
  assert.doesNotMatch(clean, /supersecrettoken/);
  assert.doesNotMatch(clean, /verysecretkey/);
  assert.doesNotMatch(clean, /my-top-secret/);
  assert.doesNotMatch(clean, /corp-custom-secret-xyz9/);
  assert.doesNotMatch(clean, /MIIEowIBAAKCAQEA/);
  assert.match(clean, /\[REDACTED_PRIVATE_KEY\]/);
  assert.match(clean, /ghp_\*+ghij/);
});

test('resolveAgentHarnessConfig & importAgentConfigTemplate: whole-file selection with CLI -m overrides', () => {
  const fakeHome = mkTmp('asdlc-agent-home-');
  const templateSrc = path.join(fakeHome, 'enterprise-opencode.json');
  try {
    const templateContent = JSON.stringify({ provider: { ark: { options: { baseURL: 'https://ark.corp/v1' } } }, model: 'ark/default' }, null, 2);
    fs.writeFileSync(templateSrc, templateContent);

    // Host file exists initially -> inherited
    const hostCfgDir = path.join(fakeHome, '.config', 'opencode');
    fs.mkdirSync(hostCfgDir, { recursive: true });
    fs.writeFileSync(path.join(hostCfgDir, 'opencode.json'), JSON.stringify({ model: 'anthropic/claude-sonnet-4-5' }));

    const inherited = resolveAgentHarnessConfig({ homeDir: fakeHome, cliModel: 'doubao-seed-code', cliReviewModel: 'openai/gpt-4o' });
    assert.equal(inherited.configSource, 'host-inherited');
    assert.deepEqual(inherited.buildAuthorArgs('draft spec'), ['run', '-m', 'doubao-seed-code', 'draft spec']);
    assert.deepEqual(inherited.buildReviewerArgs('review spec'), ['run', '-m', 'openai/gpt-4o', 'review spec']);
    assert.equal(inherited.heterogeneous, true);

    // Import enterprise template -> overrides host config atomically without modifying host file
    importAgentConfigTemplate(templateSrc, { homeDir: fakeHome });
    const ent = resolveAgentHarnessConfig({ homeDir: fakeHome });
    assert.equal(ent.configSource, 'enterprise-template');
    assert.match(ent.baseConfigPath, /\.asdlc[\\/]agent[\\/]opencode[\\/]opencode\.json$/);
    // Host config stays untouched
    assert.match(fs.readFileSync(path.join(hostCfgDir, 'opencode.json'), 'utf8'), /claude-sonnet-4-5/);
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('100% Auto-PR: createPR creates Spec PR and Impl PR seamlessly via GitHub App and GitLab Project tokens', async () => {
  const repo = mkTmp('asdlc-autopr-');
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'dev'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'dev@example.com'], { cwd: repo });
    fs.mkdirSync(path.join(repo, 'openspec', 'changes'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'README.md'), '# app\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });

    const slug = newChange('update docs spacing', { repoRoot: repo, id: 'auto-pr-spec', grill: false, openspec: false });
    const cdir = path.join(repo, 'openspec', 'changes', slug);
    fs.writeFileSync(path.join(cdir, 'proposal.md'), '# Proposal: Update docs spacing\nFix doc spacing.\n');
    fs.mkdirSync(path.join(cdir, 'specs', 'docs'), { recursive: true });
    fs.writeFileSync(path.join(cdir, 'specs', 'docs', 'spec.md'), [
      '# Docs Spec',
      '',
      '## Purpose',
      'Improve markdown spacing consistency across documentation files.',
      '',
      '## ADDED Requirements',
      '### Requirement: Spacing Check',
      'The formatter SHALL preserve single blank lines.',
      '#### Scenario: Format README',
      '- **GIVEN** a markdown document',
      '- **WHEN** formatting runs',
      '- **THEN** spacing matches guidelines',
      '- [ ] AC1: Spacing verified (test: test/docs.test.js)',
      '',
      '## Test Strategy',
      'Run doc spacing test.',
      '',
    ].join('\n'));

    // 1. Spec PR via GitHub App installation token
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/demo.git'], { cwd: repo });
    execFileSync('git', ['checkout', '-qb', `spec/${slug}`], { cwd: repo });
    const ghCalls = [];
    const specPr = await createPR(slug, 'main', {
      repoRoot: repo,
      mode: 'spec-first',
      skipPush: true,
      skipCliPr: true,
      env: { ASDLC_GITHUB_APP_TOKEN: 'ghs_autoPrAppToken111' },
      fetchFn: async (url, init) => {
        ghCalls.push({ url, auth: init.headers.Authorization });
        if (url.endsWith('/pulls')) {
          return { ok: true, json: async () => ({ number: 101, html_url: 'https://github.com/acme/demo/pull/101' }) };
        }
        return { ok: true, json: async () => ({}) };
      },
    });
    assert.equal(specPr.type, 'spec');
    assert.equal(specPr.prUrl, 'https://github.com/acme/demo/pull/101');
    assert.ok(ghCalls.some((c) => c.url.endsWith('/repos/acme/demo/pulls') && c.auth === 'Bearer ghs_autoPrAppToken111'));

    // Merge Spec PR to main and approve specSha via mergeChange
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'spec pr metadata'], { cwd: repo });
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: repo });
    execFileSync('git', ['merge', '--no-ff', '-qm', 'merge spec', `spec/${slug}`], { cwd: repo });
    mergeChange(slug, { repoRoot: repo, mode: 'spec-first', commit: true, tag: false });

    // Switch remote to GitLab and implement on impl/<slug>
    execFileSync('git', ['remote', 'set-url', 'origin', 'https://gitlab.corp.company.com/acme/demo.git'], { cwd: repo });
    execFileSync('git', ['checkout', '-qb', `impl/${slug}`], { cwd: repo });
    fs.mkdirSync(path.join(repo, 'test'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'test', 'docs.test.js'), 'import assert from "node:assert"; assert.ok(true);\n');
    fs.writeFileSync(path.join(cdir, 'tasks.md'), '# Tasks\n\n- [x] Task 1: Format docs (AC1) — _Verify: `node --test test/docs.test.js`_ (pass)\n');
    const evDir = path.join(cdir, 'evidence');
    fs.mkdirSync(evDir, { recursive: true });
    fs.writeFileSync(path.join(evDir, 'task-1.json'), JSON.stringify({ red: { ok: false }, green: { ok: true } }));
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'impl docs formatting'], { cwd: repo });

    const glCalls = [];
    const implPr = await createPR(slug, 'main', {
      repoRoot: repo,
      mode: 'spec-first',
      skipPush: true,
      skipCliPr: true,
      skipOpenspec: true,
      skipExternal: true,
      env: { ASDLC_GITLAB_TOKEN: 'glpat-autoPrGitLab222' },
      fetchFn: async (url, init) => {
        glCalls.push({ url, token: init.headers['PRIVATE-TOKEN'] });
        return { ok: true, json: async () => ({ iid: 55, web_url: 'https://gitlab.corp.company.com/acme/demo/-/merge_requests/55' }) };
      },
    });
    assert.equal(implPr.type, 'impl');
    assert.equal(implPr.prUrl, 'https://gitlab.corp.company.com/acme/demo/-/merge_requests/55');
    assert.ok(glCalls.some((c) => c.url.includes('/api/v4/projects/acme%2Fdemo/merge_requests') && c.token === 'glpat-autoPrGitLab222'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
