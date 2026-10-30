import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { statusChange, statusPortfolio } from '../src/commands/status.js';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'asdlc.js');

function setupTestRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-status-test-'));
  // init git repo
  execFileSync('git', ['init', tmp], { stdio: 'ignore' });
  execFileSync('git', ['-C', tmp, 'config', 'user.name', 'test'], { stdio: 'ignore' });
  execFileSync('git', ['-C', tmp, 'config', 'user.email', 'test@example.com'], { stdio: 'ignore' });
  
  const osDir = path.join(tmp, 'openspec', 'changes');
  fs.mkdirSync(osDir, { recursive: true });
  return tmp;
}

test('asdlc status: reports empty state when no changes in flight', () => {
  const repo = setupTestRepo();
  try {
    const out = execFileSync(process.execPath, [bin, 'status', '--repo-root', repo], { encoding: 'utf8' });
    assert.match(out, /No active changes in flight/);
    assert.match(out, /asdlc new/);

    const jsonOut = execFileSync(process.execPath, [bin, 'status', '--repo-root', repo, '--json'], { encoding: 'utf8' });
    const json = JSON.parse(jsonOut);
    assert.equal(json.total, 0);
    assert.deepEqual(json.active, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('asdlc status: lists active changes in compact table and excludes archive', () => {
  const repo = setupTestRepo();
  try {
    const changesDir = path.join(repo, 'openspec', 'changes');

    // 1. Active change 1 (L2, drafting)
    const c1 = path.join(changesDir, 'payment-gateway');
    fs.mkdirSync(c1, { recursive: true });
    fs.writeFileSync(path.join(c1, '.openspec.yaml'), 'level: "L2"\nrequirement: "integrate stripe webhook"\n');
    fs.writeFileSync(path.join(c1, 'explore.md'), '# Explore\n');

    // 2. Active change 2 (L1, ready for impl)
    const c2 = path.join(changesDir, 'typo-fix');
    fs.mkdirSync(path.join(c2, 'specs', 'ui'), { recursive: true });
    fs.writeFileSync(path.join(c2, '.openspec.yaml'), 'level: "L1"\nrequirement: "fix typo in title"\n');
    fs.writeFileSync(path.join(c2, 'explore.md'), '# Explore\n');
    fs.writeFileSync(path.join(c2, 'proposal.md'), '# Proposal\n');
    fs.writeFileSync(path.join(c2, 'specs', 'ui', 'spec.md'), '# Spec\n');

    // 3. Archived directory (should be ignored)
    const archDir = path.join(changesDir, 'archive', 'old-feature');
    fs.mkdirSync(archDir, { recursive: true });
    fs.writeFileSync(path.join(archDir, '.openspec.yaml'), 'level: "L1"\n');

    // 4. Marked archived change (should be ignored)
    const c4 = path.join(changesDir, 'closed-task');
    fs.mkdirSync(c4, { recursive: true });
    fs.writeFileSync(path.join(c4, '.openspec.yaml'), 'status: "archived"\nlevel: "L0"\n');

    const out = execFileSync(process.execPath, [bin, 'status', '--repo-root', repo], { encoding: 'utf8' });
    
    // Assert active changes are listed
    assert.match(out, /Active changes \(2 in flight\)/);
    assert.match(out, /payment-gateway/);
    assert.match(out, /typo-fix/);
    assert.match(out, /L2/);
    assert.match(out, /L1/);

    // Assert archived changes are NOT listed
    assert.doesNotMatch(out, /old-feature/);
    assert.doesNotMatch(out, /closed-task/);

    // Test --json output
    const jsonOut = execFileSync(process.execPath, [bin, 'status', '--repo-root', repo, '--json'], { encoding: 'utf8' });
    const json = JSON.parse(jsonOut);
    assert.equal(json.total, 2);
    assert.equal(json.active.length, 2);
    assert.equal(json.active[0].slug, 'payment-gateway');
    assert.equal(json.active[0].level, 'L2');
    assert.equal(json.active[1].slug, 'typo-fix');
    assert.equal(json.active[1].level, 'L1');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('asdlc status <changeId>: shows single change lifecycle and supports --json', () => {
  const repo = setupTestRepo();
  try {
    const changesDir = path.join(repo, 'openspec', 'changes');
    const c1 = path.join(changesDir, 'auth-jwt');
    fs.mkdirSync(c1, { recursive: true });
    fs.writeFileSync(path.join(c1, '.openspec.yaml'), 'level: "L3"\n');
    fs.writeFileSync(path.join(c1, 'explore.md'), '# Explore\n');

    const out = execFileSync(process.execPath, [bin, 'status', 'auth-jwt', '--repo-root', repo], { encoding: 'utf8' });
    assert.match(out, /change: auth-jwt/);
    assert.match(out, /\[x\] 1 explore \(draft\)/);

    const jsonOut = execFileSync(process.execPath, [bin, 'status', 'auth-jwt', '--repo-root', repo, '--json'], { encoding: 'utf8' });
    const json = JSON.parse(jsonOut);
    assert.equal(json.change, 'auth-jwt');
    assert.equal(json.exists, true);
    assert.equal(json.level, 'L3');
    assert.ok(Array.isArray(json.stage));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
