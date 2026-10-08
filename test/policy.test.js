import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { matchesAny, globToRe, loadPolicy, isAdvisory, DEFAULT_POLICY } from '../src/lib/policy.js';

test('glob matching: * within segment, ** across segments', () => {
  assert.ok(matchesAny('openspec/changes/tech-1/proposal.md', ['openspec/changes/*/proposal.md']));
  assert.ok(!matchesAny('openspec/changes/tech-1/specs/x.md', ['openspec/changes/*/proposal.md']));
  assert.ok(matchesAny('openspec/changes/tech-1/specs/cap/spec.md', ['openspec/changes/*/specs/**']));
  assert.ok(matchesAny('docs/a/b.md', ['docs/**']));
  assert.ok(globToRe('a/*/b').test('a/x/b'));
});

test('loadPolicy: defaults when absent, merged when present', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-pol-'));
  assert.deepEqual(loadPolicy(repo).locked_paths, DEFAULT_POLICY.locked_paths);

  fs.mkdirSync(path.join(repo, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.sdlc', 'policy.yaml'), 'rollout_mode:\n  schema-managed: advisory\n');
  const p = loadPolicy(repo);
  assert.equal(p.rollout_mode['schema-managed'], 'advisory');
  assert.deepEqual(p.locked_paths, DEFAULT_POLICY.locked_paths); // defaults preserved
});

test('isAdvisory only for explicit advisory checks', () => {
  assert.equal(isAdvisory(DEFAULT_POLICY, 'schema-managed'), false);
  assert.equal(isAdvisory({ rollout_mode: { 'schema-managed': 'advisory' } }, 'schema-managed'), true);
});
