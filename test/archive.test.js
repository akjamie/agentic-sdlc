import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { archiveChange } from '../src/commands/archive.js';
import { ROUTING_MARKER, STATUS_MARKER } from '../src/lib/agents.js';

function tmpRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-arch-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'README.md'), '# Project\n');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'init'], { cwd: repo });
  return repo;
}

function scaffoldChange(repo, slug) {
  const cdir = path.join(repo, 'openspec', 'changes', slug);
  fs.mkdirSync(path.join(cdir, 'specs', 'sample'), { recursive: true });
  fs.writeFileSync(path.join(cdir, '.openspec.yaml'), 'schema: agentic-repo-change\n');
  fs.writeFileSync(path.join(cdir, 'proposal.md'), `# Proposal: ${slug}\n\n## Why\nTesting archive behavior.\n`);
  fs.writeFileSync(path.join(cdir, 'specs', 'sample', 'spec.md'), '# Spec\n');
  return cdir;
}

test('archiveChange: creates AGENTS.md if it does not exist', () => {
  const repo = tmpRepo();
  scaffoldChange(repo, 'feat-one');
  const agentsPath = path.join(repo, 'AGENTS.md');
  assert.ok(!fs.existsSync(agentsPath), 'AGENTS.md must not exist initially');

  archiveChange('feat-one', { repoRoot: repo, openspec: false });

  assert.ok(fs.existsSync(agentsPath), 'AGENTS.md should be created by archiveChange when missing');
  const content = fs.readFileSync(agentsPath, 'utf8');
  assert.ok(content.includes(ROUTING_MARKER));
  assert.ok(content.includes(STATUS_MARKER));
  assert.ok(content.includes('asdlc new'));
});

test('archiveChange: refreshes system status in existing AGENTS.md', () => {
  const repo = tmpRepo();
  scaffoldChange(repo, 'feat-two');
  const agentsPath = path.join(repo, 'AGENTS.md');
  fs.writeFileSync(agentsPath, '# Custom Readme Notes\n\nSome hand-written notes.\n');

  archiveChange('feat-two', { repoRoot: repo, openspec: false });

  const content = fs.readFileSync(agentsPath, 'utf8');
  assert.ok(content.includes('# Custom Readme Notes'), 'Preserves hand-written notes');
  assert.ok(content.includes(STATUS_MARKER), 'Includes status marker');
  assert.ok(content.includes(ROUTING_MARKER), 'Includes routing marker');
});

test('archiveChange: skips AGENTS.md update when --no-agents is passed', () => {
  const repo = tmpRepo();
  scaffoldChange(repo, 'feat-three');
  const agentsPath = path.join(repo, 'AGENTS.md');

  archiveChange('feat-three', { repoRoot: repo, openspec: false, agents: false });

  assert.ok(!fs.existsSync(agentsPath), 'AGENTS.md should not be created when agents is false');
});

test('archiveChange: updates README.md with living spec entry', () => {
  const repo = tmpRepo();
  scaffoldChange(repo, 'feat-four');
  const readmePath = path.join(repo, 'README.md');

  archiveChange('feat-four', { repoRoot: repo, openspec: false });

  const readme = fs.readFileSync(readmePath, 'utf8');
  assert.ok(readme.includes('`feat-four`'));
  assert.ok(readme.includes('Testing archive behavior.'));
});
