import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildCli } from '../src/cli.js';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'asdlc.js');

test('asdlc --version prints the package version', () => {
  const out = execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf8' }).trim();
  assert.match(out, /^\d+\.\d+\.\d+$/);
});

test('asdlc is a minimal surface: 7 stages + navigation + health', () => {
  const names = buildCli().commands.map((c) => c.name());
  const expected = ['init', 'new', 'lint', 'approve', 'apply', 'verify', 'archive', 'status', 'doctor'];
  for (const cmd of expected) assert.ok(names.includes(cmd), `missing command: ${cmd}`);
  // Folded / removed commands must not resurface (note: no raw `openspec` escape hatch).
  for (const bad of ['explore', 'propose', 'review', 'gate', 'gap', 'supersede', 'schema', 'graph', 'merge', 'change', 'openspec']) {
    assert.ok(!names.includes(bad), `must not expose '${bad}'`);
  }
  assert.equal(names.length, expected.length, `unexpected extra commands: ${names.join(', ')}`);
});
