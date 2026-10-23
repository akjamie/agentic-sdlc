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
  assert.match(out, /api-design/);
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

test('skills parity: assets/skills and .agents/skills are byte-for-byte identical', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const assetsSkills = path.join(repoRoot, 'assets', 'skills');
  const dotAgentsSkills = path.join(repoRoot, '.agents', 'skills');

  const assetList = fs.readdirSync(assetsSkills).sort();
  const agentList = fs.readdirSync(dotAgentsSkills).sort();
  assert.deepEqual(assetList, agentList, 'skills directory list should match');

  for (const skillName of assetList) {
    const assetFile = path.join(assetsSkills, skillName, 'SKILL.md');
    const agentFile = path.join(dotAgentsSkills, skillName, 'SKILL.md');
    assert.ok(fs.existsSync(assetFile), `${assetFile} must exist`);
    assert.ok(fs.existsSync(agentFile), `${agentFile} must exist`);
    const assetContent = fs.readFileSync(assetFile);
    const agentContent = fs.readFileSync(agentFile);
    assert.ok(assetContent.equals(agentContent), `${skillName}/SKILL.md should be identical across assets and .agents`);
  }
});

test('asdlc-impl-review: incorporates Anthropic review principles', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const content = fs.readFileSync(path.join(root, 'assets', 'skills', 'asdlc-impl-review', 'SKILL.md'), 'utf8');

  // Anti-thrashing & Convergence
  assert.match(content, /Convergence Protocol/);
  assert.match(content, /3 rounds/);
  assert.match(content, /Diff-Only Re-Review/);
  assert.match(content, /Class-of-Bug Grouping/);
  assert.match(content, /ESCALATED_TO_HUMAN/);

  // Repo-Level Contract
  assert.match(content, /REVIEW\.md/);
  assert.match(content, /What failure looks like/);

  // Risk Tiering
  assert.match(content, /Risk-Based Tiering/);
  assert.match(content, /Tier 1 \(Low Risk\)/);
  assert.match(content, /Tier 3 \(High Risk\)/);

  // Defect Attribution
  assert.match(content, /\[Blocker: Introduced\]/);
  assert.match(content, /\[Tech Debt: Pre-existing\]/);
});
