import path from 'node:path';
import { exists, ensureDir, copyTree, readText, writeText, listDir } from '../lib/fs.js';
import { openspecDir, configAssetFile, ciAssetDir, githooksAssetDir, schemaAssetDir, policyAssetFile, skillsAssetDir, SCHEMA_NAME } from '../lib/paths.js';
import { installSchema, builtinSchemaVersion, localOverride } from '../lib/schema.js';
import { log } from '../lib/log.js';
import { runOpenspec, openspecVersion, ensureOpenspec } from '../lib/openspec.js';
import { git } from '../lib/git.js';
import { ensureGraphify, buildGraph, ensureGitignore } from '../lib/graphify.js';
import { refreshAgents } from '../lib/agents.js';
import { ensureRemoteLabels } from './pr.js';

// Directory -> OpenSpec tool id. We detect what the repo already uses so we can
// wire OpenSpec's own agent commands/skills (we do NOT invent our own).
const TOOL_DIRS = {
  '.opencode': 'opencode',
  '.claude': 'claude',
  '.codex': 'codex',
  '.pi': 'pi',
  '.dsh': 'dsh',
  '.cursor': 'cursor',
  '.gemini': 'gemini',
  '.qwen': 'qwen',
  '.trae': 'trae',
  '.zed': 'zed',
  '.windsurf': 'windsurf',
  '.devin': 'devin',
  '.agents': 'agents',
};

export function detectTools(repoRoot) {
  return Object.entries(TOOL_DIRS)
    .filter(([dir]) => exists(path.join(repoRoot, dir)))
    .map(([, id]) => id);
}

export function initRepo(opts = {}) {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const osDir = openspecDir(repoRoot);

  // 1) Ensure the OpenSpec ENGINE is installed (pinned devDependency), then
  //    REUSE it for setup: init the project + wire agent tooling. Re-running
  //    is idempotent and never resets our governance config.
  const osInstall = opts.openspec === false
    ? { installed: openspecVersion(repoRoot) != null, action: 'skipped' }
    : ensureOpenspec(repoRoot);
  if (!osInstall.installed) {
    log.warn('openspec CLI unavailable and could not be installed (need npm)');
  } else {
    if (osInstall.action === 'npm-install') log.ok(`installed openspec@${'1.13.2'} (devDependency)`);
    const tools = opts.tools ?? (detectTools(repoRoot).join(',') || 'none');
    const res = runOpenspec(['init', '--tools', tools, '--no-animation'], repoRoot);
    if (res.status === 0) log.ok(`openspec init --tools ${tools}`);
    else log.warn(`openspec init returned ${res.status} (non-fatal)`);
  }
  ensureDir(path.join(osDir, 'changes'));
  ensureDir(path.join(osDir, 'specs'));

  // 1.5) BU-managed OpenSpec schema: install ONCE per machine (central), never
  //      copied into the repo. This IS the OpenSpec customization layer - the
  //      enterprise change flow (proposal -> specs -> review -> tasks).
  const override = localOverride(repoRoot);
  if (override.tracked) {
    log.warn(`committed local schema copy found: ${override.path}`);
    log.warn('the BU standard forbids per-repo schema overrides; remove it (the schema is installed centrally by `asdlc init`)');
  }
  const schemaDest = installSchema();
  log.ok(`installed managed schema v${builtinSchemaVersion()} -> ${path.relative(repoRoot, schemaDest) || schemaDest}`);
  if (opts.vendor) {
    const vendored = path.join(osDir, 'schemas', SCHEMA_NAME);
    copyTree(schemaAssetDir, vendored);
    log.ok(`vendored schema -> openspec/schemas/${SCHEMA_NAME} (CI-only; do not commit)`);
  }

  // 2) Governance overlay: schema name + context + rules + lint + verify policy.
  const configDest = path.join(osDir, 'config.yaml');
  const MARKER = 'asdlc governance overlay';
  const hasOurs = exists(configDest) && readText(configDest).includes(MARKER);
  if (hasOurs && !opts.force) {
    log.step('governance config already present (use --force to overlay)');
  } else {
    let content = readText(configAssetFile);
    if (!/^schemaVersion:/m.test(content) && builtinSchemaVersion()) {
      content = `${content.trimEnd()}\nschemaVersion: "${builtinSchemaVersion()}"\n`;
    }
    writeText(configDest, content);
    log.ok('wrote governance config (openspec/config.yaml)');
  }

  // 3) CI + git hooks (governance glue, not OpenSpec's job).
  if (opts.ci === 'jenkins') {
    const dest = path.join(repoRoot, 'Jenkinsfile');
    if (exists(dest) && !opts.force) log.step('Jenkinsfile exists (use --force)');
    else { writeText(dest, readText(path.join(ciAssetDir, 'Jenkinsfile'))); log.ok('wrote Jenkinsfile'); }
  }
  if (opts.hooks !== false) installHooks(repoRoot);

  // 3.6) Pre-provision remote governance labels if git remote & gh are available
  try {
    ensureRemoteLabels(repoRoot);
  } catch { /* ignore */ }

  // 4) graphify (BU standard): a code-derived navigation graph for spec drafting.
  //    Deterministic code-only AST (no LLM key), bound to HEAD, derived cache.
  if (opts.graph !== false) {
    const g = ensureGraphify();
    if (!g.installed) {
      log.warn('graphify not installed and could not be installed');
      log.info('  install it (uv tool install graphifyy, or pip install graphifyy via your internal mirror)');
    } else {
      if (g.action !== 'present') log.ok(`installed graphify (${g.action})`);
      const b = buildGraph(repoRoot);
      if (b.status === 0) log.ok('built graphify code graph -> graphify-out/ (bound to HEAD)');
      else log.warn('graphify build failed (non-fatal)');
      if (ensureGitignore(repoRoot)) log.ok('added graphify-out/ to .gitignore');
    }
  }

  // 4.5) Bundled Agent Skills: install out-of-the-box skills (grilling, asdlc-apply)
  //      into the project's agent tools directory (.agents/skills, .claude/skills, etc.)
  const explicitTools = opts.tools ? opts.tools.split(',').map((s) => s.trim().toLowerCase()) : [];
  const allTools = [...new Set([...detectTools(repoRoot), ...explicitTools])];
  installSkills(repoRoot, allTools);

  // 5) AGENTS.md: the routing layer the agentic IDE reads (workflow + system
  //    status derived from the graph). Written after the graph so status has nodes.
  refreshAgents(repoRoot);
  log.ok('refreshed AGENTS.md (asdlc workflow + system status)');

  log.info('');
  log.info('Next:');
  log.info('  1. start a spec:       asdlc new "<requirement>"');
  log.info('  2. check the spec:     asdlc lint <CHANGE-ID>');
  log.info('  3. after the spec PR merges: asdlc approve <CHANGE-ID>');
  log.info('  4. implementation PR:  asdlc verify <CHANGE-ID> --repo <name>');
  return repoRoot;
}

// All supported tools and their skills directory name (tools that use a 'skills/' subdir convention)
const TOOL_SKILLS_DIRS = {
  claude: '.claude',
  opencode: '.opencode',
  pi: '.pi',
  dsh: '.dsh',
  cursor: '.cursor',
  gemini: '.gemini',
  windsurf: '.windsurf',
  trae: '.trae',
  codex: '.codex',
  zed: '.zed',
};

export function installSkills(repoRoot, tools = []) {
  if (!exists(skillsAssetDir)) return;
  const targetDirs = ['.agents'];
  for (const t of tools) {
    const key = String(t).toLowerCase().replace(/^\./, '');
    if (TOOL_SKILLS_DIRS[key]) targetDirs.push(TOOL_SKILLS_DIRS[key]);
    else if (key) targetDirs.push(`.${key}`);
  }
  const count = listDir(skillsAssetDir).filter((d) => d.isDirectory()).length;
  for (const dir of new Set(targetDirs)) {
    const dest = path.join(repoRoot, dir, 'skills');
    copyTree(skillsAssetDir, dest);
    log.ok(`installed bundled skills (${count} skills) -> ${dir}/skills/`);
  }
}

export function installHooks(repoRoot) {
  if (!exists(githooksAssetDir)) return;
  const dest = path.join(repoRoot, '.githooks');
  copyTree(githooksAssetDir, dest);
  try {
    git(['config', 'core.hooksPath', '.githooks'], repoRoot);
    log.ok('installed .githooks (pre-push, post-merge) + core.hooksPath');
  } catch {
    log.warn('could not set core.hooksPath (not a git repo?)');
  }
}

export function register(program) {
  program
    .command('init')
    .description('set up a repo: reuse `openspec init` + governance overlay + CI/hooks')
    .option('--repo-root <path>', 'repository root (default: cwd)')
    .option('--tools <list>', 'OpenSpec agent tools (default: auto-detect)')
    .option('--ci <name>', 'scaffold a CI pipeline (supported: jenkins)')
    .option('--no-hooks', 'skip installing .githooks')
    .option('--no-graph', 'skip graphify install/build')
    .option('--no-openspec', 'skip the openspec CLI step')
    .option('--force', 'overwrite existing config / Jenkinsfile')
    .action((opts) => initRepo(opts));
}
