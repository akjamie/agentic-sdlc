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

test('archiveChange: routine feature archive avoids mutating root README.md or AGENTS.md (zero conflict hotspots)', () => {
  const repo = tmpRepo();
  scaffoldChange(repo, 'feat-one');
  const agentsPath = path.join(repo, 'AGENTS.md');
  const readmePath = path.join(repo, 'README.md');

  archiveChange('feat-one', { repoRoot: repo, openspec: false, graph: false });

  assert.ok(!fs.existsSync(agentsPath), 'routine archive must not touch or create root AGENTS.md');
  assert.equal(fs.readFileSync(readmePath, 'utf8'), '# Project\n', 'routine archive must not append to root README.md');
  assert.ok(fs.existsSync(path.join(repo, 'openspec', 'specs', 'sample', 'spec.md')), 'living spec must be synced');
});

test('archiveChange: refreshes AGENTS.md when --agents is explicitly passed and preserves custom notes', () => {
  const repo = tmpRepo();
  scaffoldChange(repo, 'feat-two');
  const agentsPath = path.join(repo, 'AGENTS.md');
  fs.writeFileSync(agentsPath, '# Custom Readme Notes\n\nSome hand-written notes.\n');

  archiveChange('feat-two', { repoRoot: repo, openspec: false, graph: false, agents: true });

  const content = fs.readFileSync(agentsPath, 'utf8');
  assert.ok(content.includes('# Custom Readme Notes'), 'Preserves hand-written notes');
  assert.ok(content.includes(STATUS_MARKER), 'Includes status marker');
  assert.ok(content.includes(ROUTING_MARKER), 'Includes routing marker');
});

test('archiveChange: refreshes AGENTS.md automatically when constitutional governance paths were modified', () => {
  const repo = tmpRepo();
  scaffoldChange(repo, 'gov-change');
  fs.mkdirSync(path.join(repo, 'openspec'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'openspec', 'config.yaml'), 'schema: agentic-repo-change\n');

  archiveChange('gov-change', { repoRoot: repo, openspec: false, graph: false });

  const agentsPath = path.join(repo, 'AGENTS.md');
  assert.ok(fs.existsSync(agentsPath), 'constitutional change should update AGENTS.md');
  assert.ok(fs.readFileSync(agentsPath, 'utf8').includes(ROUTING_MARKER));
});

test('archiveChange: skips AGENTS.md update when --no-agents is passed even on constitutional changes', () => {
  const repo = tmpRepo();
  scaffoldChange(repo, 'feat-three');
  fs.writeFileSync(path.join(repo, 'openspec', 'config.yaml'), 'schema: agentic-repo-change\n');
  const agentsPath = path.join(repo, 'AGENTS.md');

  archiveChange('feat-three', { repoRoot: repo, openspec: false, graph: false, agents: false });

  assert.ok(!fs.existsSync(agentsPath), 'AGENTS.md should not be created when agents is false');
});
