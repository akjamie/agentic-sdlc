import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runTests, parseSpecAcceptanceCriteria } from '../src/commands/test.js';

function tmpRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-testcmd-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'README.md'), '# test');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'init'], { cwd: repo });
  return repo;
}

function scaffold(repo, slug) {
  const cdir = path.join(repo, 'openspec', 'changes', slug);
  fs.mkdirSync(path.join(cdir, 'specs', 'sample'), { recursive: true });
  fs.writeFileSync(path.join(cdir, '.openspec.yaml'), 'schema: agentic-repo-change\n');
  fs.writeFileSync(path.join(cdir, 'proposal.md'), `# Proposal: ${slug}\n`);
  return cdir;
}

test('parseSpecAcceptanceCriteria: extracts ACs and test paths', () => {
  const spec = `# Spec
### Requirement: City Search
The system SHALL search cities.

#### Scenario: Normal
- **GIVEN** query
- **WHEN** search
- **THEN** returns list

**Acceptance criteria**
- [ ] AC1: returns list of matching cities (test: test/geo.test.js)
- [x] AC2: empty list when none found (test: test/geo.test.js)
`;
  const acs = parseSpecAcceptanceCriteria(spec);
  assert.equal(acs.length, 2);
  assert.equal(acs[0].id, 'AC1');
  assert.equal(acs[0].testPath, 'test/geo.test.js');
  assert.equal(acs[1].id, 'AC2');
  assert.equal(acs[1].testPath, 'test/geo.test.js');
});

test('asdlc test: succeeds and runs mapped test files', () => {
  const repo = tmpRepo();
  const cdir = scaffold(repo, 'feat-test');
  fs.mkdirSync(path.join(repo, 'test'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'test', 'sample.test.js'), 'import { test } from "node:test"; test("pass", () => {});\n');

  fs.writeFileSync(path.join(cdir, 'specs', 'sample', 'spec.md'), `# Spec
### Requirement: Sample
The system SHALL pass.

#### Scenario: Pass
- **GIVEN** a
- **WHEN** b
- **THEN** c

**Acceptance criteria**
- [ ] AC1: passes sample test (test: test/sample.test.js)
`);

  const exit = runTests('feat-test', { repoRoot: repo });
  assert.equal(exit, 0);
});

test('asdlc test: fails when mapped test file has failing assertions', () => {
  const repo = tmpRepo();
  const cdir = scaffold(repo, 'feat-fail');
  fs.mkdirSync(path.join(repo, 'test'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'test', 'failing.test.js'), 'import { test } from "node:test"; import assert from "node:assert"; test("fail", () => { assert.fail("boom"); });\n');

  fs.writeFileSync(path.join(cdir, 'specs', 'sample', 'spec.md'), `# Spec
### Requirement: Sample
The system SHALL fail.

#### Scenario: Fail
- **GIVEN** a
- **WHEN** b
- **THEN** c

**Acceptance criteria**
- [ ] AC1: fails sample test (test: test/failing.test.js)
`);

  const exit = runTests('feat-fail', { repoRoot: repo });
  assert.equal(exit, 1);
});

test('asdlc test: fails if mapped test file does not exist', () => {
  const repo = tmpRepo();
  const cdir = scaffold(repo, 'feat-missing');

  fs.writeFileSync(path.join(cdir, 'specs', 'sample', 'spec.md'), `# Spec
### Requirement: Sample
The system SHALL pass.

#### Scenario: Pass
- **GIVEN** a
- **WHEN** b
- **THEN** c

**Acceptance criteria**
- [ ] AC1: references missing file (test: test/nonexistent.test.js)
`);

  assert.throws(() => runTests('feat-missing', { repoRoot: repo }), /mapped test file\(s\) do not exist/);
});
