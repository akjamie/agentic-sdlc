import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runShell } from '../src/lib/exec.js';

test('runShell propagates env and reports status', () => {
  const ok = runShell('node -e "process.stdout.write(process.env.ASDLC_CHANGE_ID)"', process.cwd(), {
    env: { ASDLC_CHANGE_ID: 'TECH-9' },
  });
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, 'TECH-9');
});

test('runShell reports failure status and stderr', () => {
  const bad = runShell('node -e "process.exit(3)"', process.cwd());
  assert.equal(bad.status, 3);
});