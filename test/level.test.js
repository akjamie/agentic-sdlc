import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  inferInitialLevel,
  isSinglePrLevel,
  requiresHumanReview,
  readChangeLevel,
  LEVELS
} from '../src/lib/level.js';

test('inferInitialLevel: identifies L3 sensitive keywords', () => {
  const r1 = inferInitialLevel({ requirement: 'fix auth token expiration bug' });
  assert.equal(r1.level, LEVELS.L3);
  assert.match(r1.reason, /auth/);

  const r2 = inferInitialLevel({ requirement: 'update jwt password encryption' });
  assert.equal(r2.level, LEVELS.L3);
  assert.match(r2.reason, /jwt|password|security/);
});

test('inferInitialLevel: identifies L2 cross-boundary keywords', () => {
  const r1 = inferInitialLevel({ requirement: 'add new customer api endpoint' });
  assert.equal(r1.level, LEVELS.L2);
  assert.match(r1.reason, /api/);

  const r2 = inferInitialLevel({ requirement: 'run database migration for user table' });
  assert.equal(r2.level, LEVELS.L2);
  assert.match(r2.reason, /database|migration/);
});

test('inferInitialLevel: identifies L0 trivial keywords', () => {
  const r1 = inferInitialLevel({ requirement: 'fix typo in error message' });
  assert.equal(r1.level, LEVELS.L0);
  assert.match(r1.reason, /typo/);

  const r2 = inferInitialLevel({ requirement: 'update readme docs and comments' });
  assert.equal(r2.level, LEVELS.L0);
  assert.match(r2.reason, /doc|readme/);
});

test('inferInitialLevel: defaults to L1 for bounded changes', () => {
  const r = inferInitialLevel({ requirement: 'calculate shipping discount based on quantity' });
  assert.equal(r.level, LEVELS.L1);
  assert.match(r.reason, /bounded/);
});

test('inferInitialLevel: honors explicitLevel override', () => {
  const r = inferInitialLevel({
    requirement: 'fix auth password leak',
    explicitLevel: 'L1'
  });
  assert.equal(r.level, LEVELS.L1);
  assert.match(r.reason, /explicitly specified/);
});

test('isSinglePrLevel: returns true for L0 and L1, false for L2 and L3', () => {
  assert.equal(isSinglePrLevel('L0'), true);
  assert.equal(isSinglePrLevel('L1'), true);
  assert.equal(isSinglePrLevel('L2'), false);
  assert.equal(isSinglePrLevel('L3'), false);
  assert.equal(isSinglePrLevel('UNKNOWN'), false);
});

test('requiresHumanReview: correctly evaluates human review requirement', () => {
  // L3 always requires human review
  assert.equal(requiresHumanReview('L3'), true);
  assert.equal(requiresHumanReview('L3', { contractTestVerified: true }), true);

  // L2 requires human review unless contractTestVerified is true
  assert.equal(requiresHumanReview('L2'), true);
  assert.equal(requiresHumanReview('L2', { contractTestVerified: false }), true);
  assert.equal(requiresHumanReview('L2', { contractTestVerified: true }), false);

  // L0 and L1 never require human review (auto-merge permitted)
  assert.equal(requiresHumanReview('L0'), false);
  assert.equal(requiresHumanReview('L1'), false);
});

test('readChangeLevel: reads level from .openspec.yaml', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-level-test-'));
  try {
    const changeDir = path.join(tmp, 'openspec', 'changes', 'my-feature');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, '.openspec.yaml'), 'schema: agentic-repo-change\nlevel: "L2"\n');

    const lvl = readChangeLevel(tmp, 'my-feature');
    assert.equal(lvl, 'L2');

    const nonExistent = readChangeLevel(tmp, 'other-feature');
    assert.equal(nonExistent, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
