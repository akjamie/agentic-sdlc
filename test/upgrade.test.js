import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { upgradeSkills, upgradeSchema } from '../src/commands/upgrade.js';
import { exists } from '../src/lib/fs.js';

test('upgradeSkills: refreshes bundled skills into repo agent directories', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-upgrade-skills-test-'));
  try {
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.mkdirSync(path.join(tmp, '.agents', 'skills'), { recursive: true });

    const ok = upgradeSkills(tmp);
    assert.equal(ok, true);

    const target = path.join(tmp, '.agents', 'skills', 'batch-grill-me', 'SKILL.md');
    assert.ok(exists(target));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('upgradeSkills: prunes legacy deprecated skills like asdlc-review on upgrade', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-upgrade-legacy-prune-'));
  try {
    fs.mkdirSync(path.join(tmp, '.git'));
    const legacyPath = path.join(tmp, '.agents', 'skills', 'asdlc-review');
    fs.mkdirSync(legacyPath, { recursive: true });
    fs.writeFileSync(path.join(legacyPath, 'SKILL.md'), '# Legacy Review');

    assert.ok(exists(legacyPath));

    const ok = upgradeSkills(tmp);
    assert.equal(ok, true);

    // Verify deprecated skill was cleaned up
    assert.equal(exists(legacyPath), false);
    // Verify modern active skills were installed
    assert.ok(exists(path.join(tmp, '.agents', 'skills', 'asdlc-impl-review', 'SKILL.md')));
    assert.ok(exists(path.join(tmp, '.agents', 'skills', 'asdlc-spec-review', 'SKILL.md')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('upgradeSchema: does not throw reference errors and refreshes schema', () => {
  const ok = upgradeSchema();
  assert.equal(ok, true);
});
