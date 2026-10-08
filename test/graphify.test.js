import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphStatus, readRef, writeRef, ensureGitignore, graphExists, GITIGNORE_LINE } from '../src/lib/graphify.js';

function tmpRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-gfy-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo });
  return repo;
}

test('graphStatus: missing -> fresh -> stale as HEAD moves', () => {
  const repo = tmpRepo();
  assert.equal(graphStatus(repo), 'missing');

  fs.mkdirSync(path.join(repo, 'graphify-out'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'graphify-out', 'graph.json'), '{}');
  assert.equal(graphExists(repo), true);

  const head = writeRef(repo);
  assert.ok(head);
  assert.equal(readRef(repo), head);
  assert.equal(graphStatus(repo, head), 'fresh');
  assert.equal(graphStatus(repo, 'deadbeef'), 'stale');
});

test('ensureGitignore adds the line once, idempotently', () => {
  const repo = tmpRepo();
  assert.equal(ensureGitignore(repo), true);
  assert.ok(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8').includes(GITIGNORE_LINE));
  assert.equal(ensureGitignore(repo), false); // second call is a no-op
  const lines = fs.readFileSync(path.join(repo, '.gitignore'), 'utf8').split(/\r?\n/).filter((l) => l === GITIGNORE_LINE);
  assert.equal(lines.length, 1);
});
