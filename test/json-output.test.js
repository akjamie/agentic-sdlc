import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { doctor } from '../src/commands/doctor.js';
import { statusPortfolio, statusChange } from '../src/commands/status.js';
import { runVerify } from '../src/commands/verify.js';

test('doctor --json returns structured machine-readable payload', () => {
  const outputs = [];
  const origWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    outputs.push(chunk);
    return true;
  };

  try {
    const code = doctor({ global: true, json: true });
    assert.equal(typeof code, 'number');
    assert.ok(outputs.length > 0, 'Should output JSON text');
    const parsed = JSON.parse(outputs.join(''));
    assert.equal(typeof parsed.ok, 'boolean');
    assert.equal(typeof parsed.failed, 'number');
    assert.ok(Array.isArray(parsed.checks));
    assert.ok(parsed.checks.some((c) => c.name.includes('node')));
  } finally {
    process.stdout.write = origWrite;
  }
});

test('status --json returns structured active changes payload and change detail', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-json-'));
  const openspecDir = path.join(tempDir, 'openspec');
  const changesDir = path.join(openspecDir, 'changes', 'feat-demo');
  fs.mkdirSync(changesDir, { recursive: true });
  fs.writeFileSync(path.join(changesDir, 'proposal.md'), '# Demo Proposal');
  fs.writeFileSync(path.join(changesDir, '.openspec.yaml'), 'level: L1\n');

  const outputs = [];
  const origWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    outputs.push(chunk);
    return true;
  };

  try {
    // 1. Portfolio overview
    const codePortfolio = statusPortfolio({ repoRoot: tempDir, json: true });
    assert.equal(codePortfolio, 0);
    assert.ok(outputs.length > 0);
    const parsedPortfolio = JSON.parse(outputs.join(''));
    assert.equal(parsedPortfolio.total, 1);
    assert.equal(parsedPortfolio.active[0].slug, 'feat-demo');

    // 2. Single change status
    outputs.length = 0;
    const codeChange = statusChange('feat-demo', { repoRoot: tempDir, json: true });
    assert.equal(codeChange, 0);
    assert.ok(outputs.length > 0);
    const parsedChange = JSON.parse(outputs.join(''));
    assert.equal(parsedChange.change, 'feat-demo');
    assert.equal(parsedChange.exists, true);
    assert.equal(parsedChange.level, 'L1');
    assert.equal(parsedChange.checks.proposal, true);
    assert.equal(parsedChange.checks.explore, false);

    // 3. Verify --json
    outputs.length = 0;
    const codeVerify = runVerify('feat-demo', { repoRoot: tempDir, json: true, skipOpenspec: true, skipExternal: true });
    assert.ok(outputs.length > 0);
    const parsedVerify = JSON.parse(outputs.join(''));
    assert.ok('verdict' in parsedVerify);
    assert.ok('pass' in parsedVerify);
    assert.ok('failed' in parsedVerify);
    assert.ok(Array.isArray(parsedVerify.results));
    assert.ok(parsedVerify.results.some((r) => r.name === 'repo'));
  } finally {
    process.stdout.write = origWrite;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
