import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installGlobalSkills } from '../src/commands/skills.js';
import { exists, listDir } from '../src/lib/fs.js';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'asdlc.js');

test('asdlc skills list: lists bundled skills including spec-review and impl-review', () => {
  const out = execFileSync(process.execPath, [bin, 'skills', 'list'], { encoding: 'utf8' });
  assert.match(out, /Bundled Agent Skills/);
  assert.match(out, /asdlc-spec-review/);
  assert.match(out, /asdlc-impl-review/);
  assert.match(out, /asdlc-apply/);
  assert.match(out, /batch-grill-me/);
  assert.match(out, /frontend-design/);
});

test('asdlc skills install: fails with hint when not in repo and --global is omitted', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-skills-test-'));
  try {
    const res = execFileSync(process.execPath, [bin, 'skills', 'install', '--repo-root', tmp], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    assert.fail('should have exited with error code');
  } catch (err) {
    assert.equal(err.status, 1);
    const output = `${err.stdout || ''}\n${err.stderr || ''}`;
    assert.match(output, /--global/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('installGlobalSkills: installs skills into requested tools directories', () => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-home-test-'));
  const origHome = os.homedir;

  try {
    os.homedir = () => fakeHome;

    const code = installGlobalSkills({
      tools: 'opencode,pi,dsh',
    });
    assert.equal(code, 0);

    // .agents should always be created
    const agentsDir = path.join(fakeHome, '.agents', 'skills');
    assert.ok(exists(agentsDir));
    assert.ok(exists(path.join(agentsDir, 'asdlc-spec-review', 'SKILL.md')));
    assert.ok(exists(path.join(agentsDir, 'asdlc-impl-review', 'SKILL.md')));

    // opencode, pi, dsh should be created
    assert.ok(exists(path.join(fakeHome, '.opencode', 'skills', 'asdlc-spec-review', 'SKILL.md')));
    assert.ok(exists(path.join(fakeHome, '.pi', 'skills', 'asdlc-spec-review', 'SKILL.md')));
    assert.ok(exists(path.join(fakeHome, '.dsh', 'skills', 'asdlc-spec-review', 'SKILL.md')));
  } finally {
    os.homedir = origHome;
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});
