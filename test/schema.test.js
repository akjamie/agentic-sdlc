import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { globalDataDir, checkSchema, localOverride, installSchema } from '../src/lib/schema.js';

// A temp "global data dir" so tests never touch the real machine dir.
function tmpGlobal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-gdata-'));
  return { env: { XDG_DATA_HOME: dir }, platform: 'linux', homedir: dir };
}

function tmpGitRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo });
  return repo;
}

test('globalDataDir mirrors OpenSpec on all platforms', () => {
  assert.equal(globalDataDir({ LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }, 'win32', 'C:\\Users\\x'),
    path.win32.join('C:\\Users\\x\\AppData\\Local', 'openspec'));
  assert.equal(globalDataDir({ XDG_DATA_HOME: '/xdg', LOCALAPPDATA: 'C:\\L' }, 'win32', 'C:\\x'),
    path.win32.join('/xdg', 'openspec'));
  assert.equal(globalDataDir({}, 'linux', '/home/x'), path.posix.join('/home/x', '.local', 'share', 'openspec'));
});

test('localOverride distinguishes a COMMITTED copy from an untracked one', () => {
  const repo = tmpGitRepo();
  const dir = path.join(repo, 'openspec', 'schemas', 'agentic-repo-change');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'schema.yaml'), 'name: agentic-repo-change\nversion: 1\n');

  assert.equal(localOverride(repo).present, true);
  assert.equal(localOverride(repo).tracked, false); // untracked = CI vendor, ok

  execFileSync('git', ['add', 'openspec/schemas'], { cwd: repo });
  assert.equal(localOverride(repo).tracked, true); // committed = override
});

test('checkSchema passes centrally installed, fails on override / mismatch / missing', () => {
  const opts = tmpGlobal();
  const repo = tmpGitRepo();
  installSchema(opts);
  assert.equal(checkSchema(repo, opts).ok, true);

  const dir = path.join(repo, 'openspec', 'schemas', 'agentic-repo-change');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'schema.yaml'), 'name: agentic-repo-change\nversion: 1\n');
  execFileSync('git', ['add', 'openspec/schemas'], { cwd: repo });
  const over = checkSchema(repo, opts);
  assert.equal(over.ok, false);
  assert.match(over.reason, /override/);

  // Override takes precedence over a version mismatch (it is the worse failure),
  // so the mismatch case needs a clean repo.
  const clean = tmpGitRepo();
  assert.equal(checkSchema(clean, { ...opts, expectedVersion: '99' }).ok, false);
  assert.match(checkSchema(clean, { ...opts, expectedVersion: '99' }).reason, /mismatch/);

  const fresh = tmpGlobal();
  assert.equal(checkSchema(clean, fresh).ok, false);
  assert.match(checkSchema(clean, fresh).reason, /not installed/);
});
