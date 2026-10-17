import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { updateRepo } from '../src/commands/update.js';
import { exists, writeText } from '../src/lib/fs.js';

test('update: fails with clear message when not in a git repository', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-update-nogit-'));
  try {
    const code = updateRepo({ repoRoot: tmp });
    assert.equal(code, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('update: fails with clear message when in a git repo but not initialized with asdlc', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-update-noasdlc-'));
  try {
    fs.mkdirSync(path.join(tmp, '.git'));
    const code = updateRepo({ repoRoot: tmp });
    assert.equal(code, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('update: succeeds in an initialized asdlc repository and refreshes skills & AGENTS.md', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-update-success-'));
  try {
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.mkdirSync(path.join(tmp, 'openspec'));
    fs.mkdirSync(path.join(tmp, '.agents', 'skills'), { recursive: true });

    // Seed an initial AGENTS.md
    writeText(path.join(tmp, 'AGENTS.md'), '# Existing AGENTS.md\n');

    const code = updateRepo({ repoRoot: tmp, graph: false });
    assert.equal(code, 0);

    // Verify skills were refreshed
    const skillPath = path.join(tmp, '.agents', 'skills', 'batch-grill-me', 'SKILL.md');
    assert.ok(exists(skillPath));

    // Verify AGENTS.md was refreshed
    const agentsContent = fs.readFileSync(path.join(tmp, 'AGENTS.md'), 'utf8');
    assert.match(agentsContent, /asdlc:routing/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
