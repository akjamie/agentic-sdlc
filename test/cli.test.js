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

test('asdlc is a minimal surface: 7 stages + navigation + health + skills', () => {
  const names = buildCli().commands.map((c) => c.name());
  const expected = ['init', 'new', 'lint', 'pr', 'approve', 'apply', 'verify', 'archive', 'status', 'doctor', 'upgrade', 'skills'];
  for (const cmd of expected) assert.ok(names.includes(cmd), `missing command: ${cmd}`);
  // Folded / removed commands must not resurface (note: no raw `openspec` escape hatch).
  for (const bad of ['explore', 'propose', 'review', 'gate', 'gap', 'supersede', 'schema', 'graph', 'merge', 'change', 'openspec']) {
    assert.ok(!names.includes(bad), `must not expose '${bad}'`);
  }
  assert.equal(names.length, expected.length, `unexpected extra commands: ${names.join(', ')}`);
});

test('deriveChangeSlug: derives clean slug from natural language requirement', async () => {
  const { deriveChangeSlug, extractRequirementTerms } = await import('../src/lib/cliutil.js');

  assert.equal(deriveChangeSlug('TECH-1234'), 'tech-1234');
  assert.equal(deriveChangeSlug('user-auth'), 'user-auth');
  assert.equal(deriveChangeSlug('i want to build jwt authentication'), 'jwt-authentication');
  assert.equal(deriveChangeSlug('TECH-5678: add rate limiting to payment api'), 'tech-5678-rate-limiting-payment-api');
  assert.equal(deriveChangeSlug('i want to build redis caching', { id: 'custom-cache' }), 'custom-cache');
  assert.match(deriveChangeSlug('用户输入一个中国城市名系统返回天气'), /^change-[a-z0-9]+$/);

  assert.equal(extractRequirementTerms('i want to build jwt authentication for payment api'), 'jwt authentication payment api');
});

