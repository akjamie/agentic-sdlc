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

test('upgradeSchema: does not throw reference errors and refreshes schema', () => {
  const ok = upgradeSchema();
  assert.equal(ok, true);
});
