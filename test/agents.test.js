import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { refreshAgents, ROUTING_MARKER, STATUS_MARKER } from '../src/lib/agents.js';

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-agents-'));
}

test('refreshAgents writes routing + system-status blocks', () => {
  const repo = tmpRepo();
  refreshAgents(repo);
  const md = fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8');
  assert.ok(md.includes(ROUTING_MARKER));
  assert.ok(md.includes(STATUS_MARKER));
  assert.ok(md.includes('asdlc new'));
  assert.ok(md.includes('asdlc verify'));
});

test('refreshAgents is idempotent and preserves hand-written content', () => {
  const repo = tmpRepo();
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# My project\n\nHand-written notes.\n');
  refreshAgents(repo);
  refreshAgents(repo); // second call must not duplicate markers
  const md = fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8');
  assert.ok(md.includes('Hand-written notes.'));
  assert.equal(md.split(ROUTING_MARKER).length - 1, 1);
  assert.equal(md.split(STATUS_MARKER).length - 1, 1);
});
