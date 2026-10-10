import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTestFile, isSourceFile, checkTestPresence, checkTaskEvidence } from '../src/lib/tdd.js';

test('isTestFile: recognizes standard test directories and file patterns', () => {
  assert.equal(isTestFile('test/foo.test.js'), true);
  assert.equal(isTestFile('tests/unit/bar.spec.ts'), true);
  assert.equal(isTestFile('src/__tests__/baz.js'), true);
  assert.equal(isTestFile('lib/feature.test.py'), true);
  assert.equal(isTestFile('src/index.js'), false);
  assert.equal(isTestFile('README.md'), false);
});

test('isSourceFile: recognizes source code while ignoring tests, config, and docs', () => {
  assert.equal(isSourceFile('src/commands/verify.js'), true);
  assert.equal(isSourceFile('lib/util.ts'), true);
  assert.equal(isSourceFile('app/main.py'), true);
  assert.equal(isSourceFile('test/verify.test.js'), false);
  assert.equal(isSourceFile('docs/guide.md'), false);
  assert.equal(isSourceFile('openspec/changes/tech-1/tasks.md'), false);
  assert.equal(isSourceFile('.sdlc/policy.yaml'), false);
  assert.equal(isSourceFile('package.json'), false);
});

test('checkTestPresence: fails when source files modified with zero test files', () => {
  const diff = ['src/commands/verify.js', 'src/lib/tdd.js'];
  const res = checkTestPresence(diff);
  assert.equal(res.ok, false);
  assert.match(res.detail, /without corresponding test files/);
});

test('checkTestPresence: passes when test files accompany source files', () => {
  const diff = ['src/commands/verify.js', 'test/verify.test.js'];
  const res = checkTestPresence(diff);
  assert.equal(res.ok, true);
  assert.equal(res.sources.length, 1);
  assert.equal(res.tests.length, 1);
});

test('checkTestPresence: passes when only non-source files are touched', () => {
  const diff = ['README.md', 'openspec/changes/tech-1/proposal.md'];
  const res = checkTestPresence(diff);
  assert.equal(res.ok, true);
  assert.equal(res.sources.length, 0);
});

test('checkTaskEvidence: validates completion and verification annotations', () => {
  const valid = `
# Tasks
- [x] 1.1 implement greet (AC1) verify: test/greet.test.js
- [x] 1.2 [TEST] write failing test for logout
- [x] 1.3 [IMPL] implement logout
`;
  assert.equal(checkTaskEvidence(valid).ok, true);

  const missingVerify = `
# Tasks
- [x] 1.1 just did something bare without AC or verify
`;
  assert.equal(checkTaskEvidence(missingVerify).ok, false);
});
