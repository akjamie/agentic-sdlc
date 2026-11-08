import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { assess } from '../src/assess/index.js';
import { scanDiffForSecrets } from '../src/assess/secrets.js';

function tmpGitRepo(prefix = 'asdlc-sec-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Security Test Repo\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

test('S1 (P0): scanDiffForSecrets detects hardcoded cloud AKs and PATs on diff + lines', () => {
  const diffWithSecrets = `diff --git a/config/app.yml b/config/app.yml
--- a/config/app.yml
+++ b/config/app.yml
@@ -1,3 +1,5 @@
+ alibaba_ak: LTAI5t7RealKey9988771122
+ aws_ak: AKIA1122334455667788
+ github_token: ghp_111122223333444455556666777788889999
+ interpolation: \${ENV_VAR_SHOULD_BE_IGNORED}
+ vault_key: vault:secret/data/key
`;
  const findings = scanDiffForSecrets(diffWithSecrets);
  assert.equal(findings.length, 3, 'Must detect 3 plaintext secrets and ignore interpolations');
  assert.ok(findings.some((f) => f.rule === 'ALIBABA_AK' && f.redacted.includes('****')));
  assert.ok(findings.some((f) => f.rule === 'AWS_AK' && f.redacted.includes('****')));
  assert.ok(findings.some((f) => f.rule === 'GITHUB_PAT' && f.redacted.includes('****')));
});

test('S2 (P0): assess() escalates to L3 with mandatory_human_review when diff contains plaintext secret', () => {
  const dir = tmpGitRepo();
  try {
    const secretFile = path.join(dir, 'src', 'config.js');
    fs.mkdirSync(path.dirname(secretFile), { recursive: true });
    fs.writeFileSync(secretFile, 'export const ak = "LTAI5t99988877766655";\n');

    const rec = assess({
      stage: 'impl',
      changeId: 'leak-test',
      requirement: 'update config',
      changedFiles: ['src/config.js'],
      repoRoot: dir,
      persist: false,
    });

    assert.equal(rec.risk.level, 'L3', 'Leaked AK in changed file must escalate to L3');
    assert.equal(rec.governance.auto_approval, 'disabled');
    assert.equal(rec.governance.implementation_review, 'ai+human');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('S3 (P0): assess() detects deleted security file from baseRef and escalates to L3', () => {
  const dir = tmpGitRepo();
  try {
    // 1. Commit SecurityConfig on main
    const secFile = path.join(dir, 'src', 'SecurityConfig.java');
    fs.mkdirSync(path.dirname(secFile), { recursive: true });
    fs.writeFileSync(secFile, 'import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;\npublic class SecurityConfig {}\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'add sec config'], { cwd: dir });

    // 2. Checkout feature branch and delete SecurityConfig
    execFileSync('git', ['checkout', '-b', 'delete-sec'], { cwd: dir });
    fs.rmSync(secFile);

    const rec = assess({
      stage: 'impl',
      changeId: 'del-sec-test',
      requirement: 'cleanup',
      changedFiles: ['src/SecurityConfig.java'],
      repoRoot: dir,
      baseRef: 'main',
      persist: false,
    });

    assert.equal(rec.risk.level, 'L3', 'Deleting security configuration must escalate to L3');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('S4 (P0): L0 contraction prevents requirements.txt, prompts, and agent instructions from qualifying as L0', () => {
  // 1. requirements.txt must NOT be L0
  const reqRec = assess({
    stage: 'impl',
    changeId: 'req-test',
    requirement: 'update requirements',
    changedFiles: ['requirements.txt'],
    persist: false,
  });
  assert.notEqual(reqRec.risk.level, 'L0', 'requirements.txt must not be L0');

  // 2. Agent instructions CLAUDE.md must be L3
  const claudeRec = assess({
    stage: 'impl',
    changeId: 'claude-test',
    requirement: 'update claude prompt',
    changedFiles: ['CLAUDE.md'],
    persist: false,
  });
  assert.equal(claudeRec.risk.level, 'L3', 'CLAUDE.md must be L3');

  // 3. In-source prompts under src/prompts/ must NOT be L0
  const promptRec = assess({
    stage: 'impl',
    changeId: 'prompt-test',
    requirement: 'update prompt',
    changedFiles: ['src/prompts/system.md'],
    persist: false,
  });
  assert.notEqual(promptRec.risk.level, 'L0', 'Prompt templates in source dirs must not be L0');
});
