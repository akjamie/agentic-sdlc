import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { git } from '../src/lib/git.js';
import { lintSpecText } from '../src/lib/speclint.js';
import { stageImplementationChanges } from '../src/commands/pr.js';

function tmpGitRepo(prefix = 'asdlc-utf8-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# UTF-8 Test Repo\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

test('C1 (P0): git() sets core.quotepath=off globally and returns raw UTF-8 paths without octal escape', () => {
  const dir = tmpGitRepo();
  try {
    const zhFile = path.join(dir, 'docs', '接口说明.md');
    fs.mkdirSync(path.dirname(zhFile), { recursive: true });
    fs.writeFileSync(zhFile, '# 接口文档\n');

    // Run status via git helper with -uall
    const status = git(['status', '--porcelain', '-uall'], dir);
    // Must NOT contain octal escape or quotes like "docs/\346\216\245..."
    assert.doesNotMatch(status, /"docs\\[0-9]+/, 'Git status must not octal-escape non-ASCII filenames');
    assert.match(status, /docs\/接口说明\.md/, 'Git status must contain raw UTF-8 filename');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('C1 (P0): stageImplementationChanges stages non-ASCII UTF-8 files cleanly', () => {
  const dir = tmpGitRepo();
  try {
    const zhFile = path.join(dir, 'src', '支付核心.js');
    fs.mkdirSync(path.dirname(zhFile), { recursive: true });
    fs.writeFileSync(zhFile, 'export const pay = () => true;\n');

    const res = stageImplementationChanges(dir, { maxMb: 50 });
    assert.ok(res.staged.some((f) => f.includes('支付核心.js')), 'Non-ASCII UTF-8 file must be staged');

    // Verify git index has the file staged
    const diff = git(['diff', '--cached', '--name-only'], dir);
    assert.match(diff, /支付核心\.js/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('C2 (P1): speclint strips UTF-8 BOM (\\uFEFF) before linting', () => {
  const textWithBOM = '\uFEFF## Purpose\nThis is a valid purpose that explains why this capability is added.\n\n## Test Strategy\nUnit tests.\n\n## ADDED Requirements\n### Requirement: User Login\nThe user MUST login.\n#### Scenario: Success\n**WHEN** user posts credentials\n**THEN** token is returned\n- [ ] AC1: Token valid (test: tests/login.test.js)\n';
  const findings = lintSpecText(textWithBOM);
  const purposeFindings = findings.filter((f) => f.code === 'R1-purpose');
  assert.equal(purposeFindings.length, 0, 'UTF-8 BOM must not trigger R1-purpose error');
});

test('C2 (P1): speclint diagnoses fullwidth non-ASCII colons with actionable line-number guidance', () => {
  const textWithFullwidthColon = '## Purpose\nThis is a valid purpose that explains why this capability is added.\n\n## Test Strategy\nUnit tests.\n\n## ADDED Requirements\n### Requirement：用户登录\nThe user MUST login.\n#### Scenario: Success\n**WHEN** user posts credentials\n**THEN** token is returned\n- [ ] AC1: Token valid (test: tests/login.test.js)\n';
  const findings = lintSpecText(textWithFullwidthColon);
  const colonFinding = findings.find((f) => f.message.includes('non-ASCII colon') || f.code.includes('colon'));
  assert.ok(colonFinding, 'Must emit actionable finding for non-ASCII colon in header');
});

test('C2 (P1): speclint Purpose check accepts meaningful paragraph (>=15 chars) without arbitrary 50-char constraint', () => {
  const validConcise = '## Purpose\n为支付网关实现重试与幂等机制。\n\n## Test Strategy\nUnit tests.\n\n## ADDED Requirements\n### Requirement: User Login\nThe user MUST login.\n#### Scenario: Success\n**WHEN** user posts credentials\n**THEN** token is returned\n- [ ] AC1: Token valid (test: tests/login.test.js)\n';
  const findings = lintSpecText(validConcise);
  const purposeFinding = findings.find((f) => f.code === 'R1-purpose');
  assert.equal(purposeFinding, undefined, 'Concise but meaningful Purpose >= 15 chars must pass');

  const tooShort = '## Purpose\nToo short.\n\n## Test Strategy\nUnit tests.\n\n## ADDED Requirements\n### Requirement: User Login\nThe user MUST login.\n#### Scenario: Success\n**WHEN** user posts credentials\n**THEN** token is returned\n- [ ] AC1: Token valid (test: tests/login.test.js)\n';
  const findingsShort = lintSpecText(tooShort);
  assert.ok(findingsShort.some((f) => f.code === 'R1-purpose'), 'Purpose < 15 chars must fail R1-purpose');
});
