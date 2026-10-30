import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TOOL_REGISTRY, detectTools, getToolDefinition, installSkills, installCommands, checkToolHealth } from '../src/lib/tools.js';
import { doctor } from '../src/commands/doctor.js';

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-tools-test-'));
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'openspec'), { recursive: true });
  return dir;
}

test('tools: getToolDefinition resolves canonical IDs, aliases, and directory names', () => {
  assert.equal(getToolDefinition('claude').id, 'claude');
  assert.equal(getToolDefinition('.claude').id, 'claude');
  assert.equal(getToolDefinition('opencode').id, 'opencode');
  assert.equal(getToolDefinition('pi').id, 'pi');
  assert.equal(getToolDefinition('antigravity').id, 'antigravity');
  assert.equal(getToolDefinition('.antigravity').id, 'antigravity');
  assert.equal(getToolDefinition('github-copilot').id, 'github-copilot');
  assert.equal(getToolDefinition('.github').id, 'github-copilot');
  assert.equal(getToolDefinition('cursor').id, 'cursor');
  assert.equal(getToolDefinition('trae').id, 'trae');
  assert.equal(getToolDefinition('windsurf').id, 'windsurf');
  assert.equal(getToolDefinition('.devin').id, 'windsurf');
  assert.equal(getToolDefinition('gemini').id, 'gemini');
});

test('tools: detectTools discovers Claude, OpenCode, Pi, Antigravity, GitHub Copilot, and aliases', () => {
  const repo = tmpRepo();

  // Initially only .git and openspec
  assert.deepEqual(detectTools(repo), []);

  // 1. Detect Claude Code
  fs.mkdirSync(path.join(repo, '.claude'));
  assert.ok(detectTools(repo).includes('claude'));

  // 2. Detect OpenCode
  fs.mkdirSync(path.join(repo, '.opencode'));
  assert.ok(detectTools(repo).includes('opencode'));

  // 3. Detect Pi
  fs.mkdirSync(path.join(repo, '.pi'));
  assert.ok(detectTools(repo).includes('pi'));

  // 4. Detect Antigravity (.agents and .antigravity alias)
  fs.mkdirSync(path.join(repo, '.agents'));
  assert.ok(detectTools(repo).includes('antigravity'));

  const aliasRepo = tmpRepo();
  fs.mkdirSync(path.join(aliasRepo, '.antigravity'));
  assert.ok(detectTools(aliasRepo).includes('antigravity'));

  // 5. Detect GitHub Copilot (.github)
  fs.mkdirSync(path.join(repo, '.github'));
  assert.ok(detectTools(repo).includes('github-copilot'));

  // 6. Detect Cursor & Trae & Windsurf (.devin alias)
  fs.mkdirSync(path.join(repo, '.cursor'));
  fs.mkdirSync(path.join(repo, '.trae'));
  fs.mkdirSync(path.join(repo, '.devin'));
  const tools = detectTools(repo);
  assert.ok(tools.includes('cursor'));
  assert.ok(tools.includes('trae'));
  assert.ok(tools.includes('windsurf'));
});

test('tools: installSkills installs bundled skills across detected tools', () => {
  const repo = tmpRepo();
  fs.mkdirSync(path.join(repo, '.claude'));
  fs.mkdirSync(path.join(repo, '.opencode'));
  fs.mkdirSync(path.join(repo, '.github'));
  fs.mkdirSync(path.join(repo, '.antigravity'));

  const tools = detectTools(repo);
  installSkills(repo, tools);

  // Check .agents (universal)
  assert.ok(fs.existsSync(path.join(repo, '.agents', 'skills', 'asdlc-apply', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(repo, '.agents', 'skills', 'asdlc-new', 'SKILL.md')));

  // Check .claude
  assert.ok(fs.existsSync(path.join(repo, '.claude', 'skills', 'asdlc-apply', 'SKILL.md')));

  // Check .opencode
  assert.ok(fs.existsSync(path.join(repo, '.opencode', 'skills', 'asdlc-apply', 'SKILL.md')));

  // Check .github
  assert.ok(fs.existsSync(path.join(repo, '.github', 'skills', 'asdlc-apply', 'SKILL.md')));

  // Check .antigravity alias
  assert.ok(fs.existsSync(path.join(repo, '.antigravity', 'skills', 'asdlc-apply', 'SKILL.md')));
});

test('tools: installCommands installs slash commands with tool-native extensions and formats', () => {
  const repo = tmpRepo();
  fs.mkdirSync(path.join(repo, '.claude'));
  fs.mkdirSync(path.join(repo, '.opencode'));
  fs.mkdirSync(path.join(repo, '.pi'));
  fs.mkdirSync(path.join(repo, '.github'));
  fs.mkdirSync(path.join(repo, '.gemini'));
  fs.mkdirSync(path.join(repo, '.antigravity'));

  const tools = detectTools(repo);
  installCommands(repo, tools);

  // 1. Antigravity / Agents: workflows/*.md
  assert.ok(fs.existsSync(path.join(repo, '.agents', 'workflows', 'asdlc-new.md')));
  assert.ok(fs.existsSync(path.join(repo, '.agents', 'workflows', 'asdlc-apply.md')));
  assert.ok(fs.existsSync(path.join(repo, '.agents', 'workflows', 'asdlc-lint.md')));

  // Antigravity alias mirror
  assert.ok(fs.existsSync(path.join(repo, '.antigravity', 'workflows', 'asdlc-new.md')));

  // 2. Claude Code: .claude/commands/asdlc-*.md
  assert.ok(fs.existsSync(path.join(repo, '.claude', 'commands', 'asdlc-new.md')));
  assert.ok(fs.existsSync(path.join(repo, '.claude', 'commands', 'asdlc-verify.md')));

  // 3. OpenCode: .opencode/commands/asdlc-*.md
  assert.ok(fs.existsSync(path.join(repo, '.opencode', 'commands', 'asdlc-new.md')));
  assert.ok(fs.existsSync(path.join(repo, '.opencode', 'commands', 'asdlc-status.md')));

  // 4. Pi: .pi/prompts/asdlc-*.md
  assert.ok(fs.existsSync(path.join(repo, '.pi', 'prompts', 'asdlc-new.md')));

  // 5. GitHub Copilot: .github/prompts/asdlc-*.prompt.md
  const copilotPrompt = path.join(repo, '.github', 'prompts', 'asdlc-new.prompt.md');
  assert.ok(fs.existsSync(copilotPrompt));
  const copilotContent = fs.readFileSync(copilotPrompt, 'utf8');
  assert.ok(copilotContent.includes('asdlc new'));

  // 6. Gemini CLI: .gemini/commands/asdlc/asdlc-*.toml
  const geminiCmd = path.join(repo, '.gemini', 'commands', 'asdlc', 'asdlc-new.toml');
  assert.ok(fs.existsSync(geminiCmd));
  const geminiContent = fs.readFileSync(geminiCmd, 'utf8');
  assert.ok(geminiContent.includes('description ='));
  assert.ok(geminiContent.includes('prompt ='));
});

test('tools: checkToolHealth audits skills and slash commands presence', () => {
  const repo = tmpRepo();
  fs.mkdirSync(path.join(repo, '.claude'));

  // Missing both skills and commands
  const initial = checkToolHealth(repo, 'claude');
  assert.equal(initial.status, 'warn');
  assert.equal(initial.skillsOk, false);
  assert.equal(initial.commandsOk, false);

  // Install skills only
  installSkills(repo, ['claude']);
  const partial = checkToolHealth(repo, 'claude');
  assert.equal(partial.status, 'warn');
  assert.equal(partial.skillsOk, true);
  assert.equal(partial.commandsOk, false);

  // Install commands -> passes
  installCommands(repo, ['claude']);
  const healthy = checkToolHealth(repo, 'claude');
  assert.equal(healthy.status, 'pass');
  assert.equal(healthy.skillsOk, true);
  assert.equal(healthy.commandsOk, true);
});

test('doctor: reports per-tool status and remediates with --fix', () => {
  const repo = tmpRepo();
  fs.mkdirSync(path.join(repo, '.opencode'));

  // Doctor reports warning when tool has uninstalled skills/commands
  // Intercept stdout
  let logOut = '';
  const origWrite = process.stdout.write;
  try {
    process.stdout.write = (chunk) => { logOut += chunk; return true; };
    doctor({ repoRoot: repo });
    assert.ok(logOut.includes('tool: OpenCode'));
    assert.ok(logOut.includes('[WARN]'));

    // Now run doctor with --fix
    logOut = '';
    doctor({ repoRoot: repo, fix: true });
    assert.ok(logOut.includes('fixed: synchronized skills and commands'));

    // Check that skills and commands now physically exist
    assert.ok(fs.existsSync(path.join(repo, '.opencode', 'skills', 'asdlc-apply', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(repo, '.opencode', 'commands', 'asdlc-new.md')));
  } finally {
    process.stdout.write = origWrite;
  }
});
