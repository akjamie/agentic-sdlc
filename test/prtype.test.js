import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPR, changeIdOf } from '../src/lib/prtype.js';
import { DEFAULT_POLICY } from '../src/lib/policy.js';

const policy = DEFAULT_POLICY;

test('changeIdOf extracts the change slug', () => {
  assert.equal(changeIdOf('openspec/changes/tech-1/specs/x.md'), 'tech-1');
  assert.equal(changeIdOf('src/main.js'), null);
});

test('first change dir with only spec files -> spec', () => {
  const r = classifyPR({
    changedFiles: ['openspec/changes/tech-1/proposal.md', 'openspec/changes/tech-1/specs/cap/spec.md'],
    changeOnMain: false, policy,
  });
  assert.equal(r.type, 'spec');
});

test('first PR mixing spec + source -> invalid', () => {
  const r = classifyPR({
    changedFiles: ['openspec/changes/tech-1/proposal.md', 'src/main.js'],
    changeOnMain: false, policy,
  });
  assert.equal(r.type, 'invalid');
});

test('change dir already on main + tasks/source -> impl', () => {
  const r = classifyPR({
    changedFiles: ['openspec/changes/tech-1/tasks.md', 'src/main.js'],
    changeOnMain: true, policy,
  });
  assert.equal(r.type, 'impl');
});

test('all whitelisted paths, no change dir -> fast', () => {
  const r = classifyPR({ changedFiles: ['docs/a.md', 'docs/b.md'], changeOnMain: false, policy });
  assert.equal(r.type, 'fast');
});

test('change dir move + specs merge -> archive', () => {
  const r = classifyPR({
    changedFiles: ['openspec/changes/tech-1/proposal.md', 'openspec/specs/cap/spec.md'],
    changeOnMain: true, policy,
  });
  assert.equal(r.type, 'archive');
});

test('plain source, no change dir -> normal; emergency flag wins', () => {
  assert.equal(classifyPR({ changedFiles: ['src/main.js'], changeOnMain: false, policy }).type, 'normal');
  assert.equal(classifyPR({ changedFiles: ['src/main.js'], changeOnMain: false, policy, emergency: true }).type, 'emergency');
});
