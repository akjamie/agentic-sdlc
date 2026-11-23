import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildCli } from '../src/cli.js';
import { isAgentRuntime, requireAgentRuntime } from '../src/lib/cliutil.js';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'asdlc.js');

test('asdlc --version prints the package version', () => {
  const out = execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf8' }).trim();
  assert.match(out, /^\d+\.\d+\.\d+$/);
});

test('asdlc is a minimal surface: 7 stages + navigation + health + skills + assess + config', () => {
  const names = buildCli().commands.map((c) => c.name());
  const expected = ['init', 'new', 'lint', 'pr', 'approve', 'apply', 'test', 'verify', 'archive', 'status', 'doctor', 'update', 'upgrade', 'skills', 'assess', 'config'];
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

function runCli(args, envOverrides = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...envOverrides },
  });
}

test('isAgentRuntime & requireAgentRuntime: blocks bare interactive terminal and allows agent/CI/piped/bypass contexts', () => {
  assert.equal(isAgentRuntime({ env: {}, stdinIsTTY: true, stdoutIsTTY: true }), false);
  assert.throws(
    () => requireAgentRuntime('new', { env: {}, stdinIsTTY: true, stdoutIsTTY: true }),
    (err) => err?.code === 'AGENT_RUNTIME_REQUIRED' && /cannot complete standalone in a bare terminal/.test(err.message)
  );
  assert.throws(
    () => requireAgentRuntime('apply', { env: {}, stdinIsTTY: true, stdoutIsTTY: true }),
    (err) => err?.code === 'AGENT_RUNTIME_REQUIRED' && /cannot complete standalone in a bare terminal/.test(err.message)
  );
  assert.throws(
    () => requireAgentRuntime('custom-agent-cmd', { env: {}, stdinIsTTY: true, stdoutIsTTY: true }),
    (err) => err?.code === 'AGENT_RUNTIME_REQUIRED' && /requires an AI Coding Agent session/.test(err.message)
  );

  assert.equal(isAgentRuntime({ env: {}, stdinIsTTY: false, stdoutIsTTY: true }), true);
  assert.equal(isAgentRuntime({ env: {}, stdinIsTTY: true, stdoutIsTTY: false }), true);
  assert.equal(isAgentRuntime({ env: { ASDLC_AGENT: '1' }, stdinIsTTY: true, stdoutIsTTY: true }), true);
  assert.equal(isAgentRuntime({ env: { CLAUDECODE: '1' }, stdinIsTTY: true, stdoutIsTTY: true }), true);
  assert.equal(isAgentRuntime({ env: { OPENCODE: '1' }, stdinIsTTY: true, stdoutIsTTY: true }), true);
  assert.equal(isAgentRuntime({ env: {}, stdinIsTTY: true, stdoutIsTTY: true, scaffoldOnly: true }), true);
  assert.equal(isAgentRuntime({ env: {}, stdinIsTTY: true, stdoutIsTTY: true, guardOnly: true }), true);
  assert.equal(isAgentRuntime({ env: {}, stdinIsTTY: true, stdoutIsTTY: true, agent: true }), true);

  assert.doesNotThrow(() => requireAgentRuntime('new', { env: { OPENCODE: '1' }, stdinIsTTY: true, stdoutIsTTY: true }));
});

test('CLI subprocess: hard-blocks `asdlc new` and `asdlc apply` in bare terminal unless bypass or agent runtime is set', () => {
  const blockedNew = runCli(['new', 'test feature'], { ASDLC_FORCE_INTERACTIVE_TERMINAL: '1' });
  assert.equal(blockedNew.status, 1);
  assert.match(blockedNew.stderr, /'asdlc new' cannot complete standalone in a bare terminal/);
  assert.match(blockedNew.stdout, /hint: Run '\/asdlc-new/);

  const blockedApply = runCli(['apply', 'some-id'], { ASDLC_FORCE_INTERACTIVE_TERMINAL: '1' });
  assert.equal(blockedApply.status, 1);
  assert.match(blockedApply.stderr, /'asdlc apply' cannot complete standalone in a bare terminal/);
  assert.match(blockedApply.stdout, /hint: Run '\/asdlc-apply/);

  // Explicit --scaffold-only / --guard-only / --agent bypasses the terminal block (fails later on non-repo, not AGENT_RUNTIME_REQUIRED)
  const scaffoldRes = runCli(['new', 'test feature', '--scaffold-only', '--repo-root', 'Z:\\nonexistent-asdlc-test-path'], {
    ASDLC_FORCE_INTERACTIVE_TERMINAL: '1',
  });
  assert.doesNotMatch(scaffoldRes.stderr, /cannot complete standalone in a bare terminal/);
  assert.match(scaffoldRes.stderr, /no OpenSpec project found/);

  const guardRes = runCli(['apply', 'some-id', '--guard-only', '--repo-root', 'Z:\\nonexistent-asdlc-test-path'], {
    ASDLC_FORCE_INTERACTIVE_TERMINAL: '1',
  });
  assert.doesNotMatch(guardRes.stderr, /cannot complete standalone in a bare terminal/);
  assert.match(guardRes.stderr, /no OpenSpec project found/);
});

test('CLI subprocess: hard-blocks agent-only subcommands with concise Agent guidance', () => {
  const cases = [
    { args: ['impl-review', '#44'], errRe: /'asdlc impl-review' cannot run in a terminal/, hintRe: /\/asdlc-impl-review/ },
    { args: ['spec-review', 'my-id'], errRe: /'asdlc spec-review' cannot run in a terminal/, hintRe: /\/asdlc-spec-review/ },
    { args: ['review'], errRe: /'asdlc review' cannot run in a terminal/, hintRe: /\/asdlc-impl-review/ },
    { args: ['grill-me'], errRe: /'asdlc grill-me' cannot run in a terminal/, hintRe: /\/grill-me/ },
    { args: ['intake'], errRe: /'asdlc intake' cannot run standalone in a terminal/, hintRe: /\/asdlc-new/ },
    { args: ['run'], errRe: /'asdlc run' is not a standalone CLI command/, hintRe: /asdlc verify <changeId>/ },
  ];

  for (const { args, errRe, hintRe } of cases) {
    const res = runCli(args);
    assert.equal(res.status, 1, `expected exit 1 for asdlc ${args.join(' ')}`);
    assert.match(res.stderr, errRe, `unexpected stderr for asdlc ${args.join(' ')}`);
    assert.match(res.stdout, hintRe, `unexpected hint for asdlc ${args.join(' ')}`);
  }

  // Ensure standard flags still work without tripping AGENT_ONLY_COMMANDS
  const versionRes = runCli(['--version']);
  assert.equal(versionRes.status, 0);
  assert.match(versionRes.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

