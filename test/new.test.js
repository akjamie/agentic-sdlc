import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { newChange } from '../src/commands/new.js';

function tmpRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-new-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  fs.mkdirSync(path.join(repo, 'openspec'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'README.md'), '# test');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'init'], { cwd: repo });
  return repo;
}

test('newChange: auto-seeds design.md when requirement mentions UI or API keywords', () => {
  const repo = tmpRepo();
  const slug = newChange('build responsive web ui for tourism itinerary recommendations', { repoRoot: repo, openspec: false });
  const cdir = path.join(repo, 'openspec', 'changes', slug);
  const designPath = path.join(cdir, 'design.md');

  assert.ok(fs.existsSync(designPath), 'design.md should be auto-seeded for UI requirement');
  const content = fs.readFileSync(designPath, 'utf8');
  assert.ok(content.includes('Technical Design'));
  assert.ok(content.includes('System Architecture'));
  assert.ok(content.includes('Interface Contracts'));
  assert.ok(content.includes('External Services'));
  assert.ok(content.includes('UI/UX Design, Visual Hierarchy & Aesthetics'));
});

test('newChange: seeds design.md when --design flag is explicitly passed', () => {
  const repo = tmpRepo();
  const slug = newChange('small logic adjustment', { repoRoot: repo, design: true, id: 'logic-adj', openspec: false });
  const cdir = path.join(repo, 'openspec', 'changes', slug);
  const designPath = path.join(cdir, 'design.md');

  assert.ok(fs.existsSync(designPath), 'design.md should be seeded when --design is true');
});

test('newChange: respects --no-design even if requirement matches keywords', () => {
  const repo = tmpRepo();
  const slug = newChange('build web ui screen', { repoRoot: repo, design: false, id: 'no-design-slug', openspec: false });
  const cdir = path.join(repo, 'openspec', 'changes', slug);
  const designPath = path.join(cdir, 'design.md');

  assert.ok(!fs.existsSync(designPath), 'design.md should not be seeded when design is false');
});

test('newChange: does not seed design.md for simple non-technical requirement', () => {
  const repo = tmpRepo();
  const slug = newChange('update greeting text message in config', { repoRoot: repo, id: 'simple-greeting', openspec: false });
  const cdir = path.join(repo, 'openspec', 'changes', slug);
  const designPath = path.join(cdir, 'design.md');

  assert.ok(!fs.existsSync(designPath), 'design.md should not be seeded for non-UI/non-tech requirement');
});
