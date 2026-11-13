import path from 'node:path';
import fs from 'node:fs';
import { exists, ensureDir, copyTree, readText, writeText } from '../lib/fs.js';
import { openspecDir, configAssetFile, schemaAssetDir, SCHEMA_NAME } from '../lib/paths.js';
import { installSchema, builtinSchemaVersion, localOverride } from '../lib/schema.js';
import { log } from '../lib/log.js';
import { git } from '../lib/git.js';
import { runOpenspec, openspecVersion, ensureOpenspec } from '../lib/openspec.js';
import { ensureGraphify, buildGraph, ensureGitignore } from '../lib/graphify.js';
import { refreshAgents } from '../lib/agents.js';
import { ensureRemoteLabels } from './pr.js';
import { detectTools, installSkills, installCommands } from '../lib/tools.js';

export { detectTools, installSkills, installCommands };

/**
 * Discovers language stack, package manager, and test/lint/build commands in a repository
 * for `--onboard` brownfield governance integration.
 */
export function discoverRepoStack(repoRoot) {
  const languages = [];
  let packageManager = null;
  let testCommand = null;
  let lintCommand = null;
  let buildCommand = null;

  const pkgPath = path.join(repoRoot, 'package.json');
  if (exists(pkgPath)) {
    languages.push('javascript/node');
    packageManager = exists(path.join(repoRoot, 'pnpm-lock.yaml'))
      ? 'pnpm'
      : (exists(path.join(repoRoot, 'yarn.lock')) ? 'yarn' : 'npm');
    try {
      const pkg = JSON.parse(readText(pkgPath));
      const scripts = pkg?.scripts || {};
      if (scripts.test) testCommand = `${packageManager} test`;
      if (scripts.lint) lintCommand = `${packageManager} run lint`;
      if (scripts.build) buildCommand = `${packageManager} run build`;
    } catch {
      // ignore invalid package.json
    }
  }
  if (exists(path.join(repoRoot, 'pyproject.toml')) || exists(path.join(repoRoot, 'requirements.txt'))) {
    languages.push('python');
    if (!testCommand) testCommand = 'pytest';
    if (!lintCommand) lintCommand = 'ruff check .';
  }
  if (exists(path.join(repoRoot, 'go.mod'))) {
    languages.push('go');
    if (!testCommand) testCommand = 'go test ./...';
    if (!buildCommand) buildCommand = 'go build ./...';
  }
  if (exists(path.join(repoRoot, 'Cargo.toml'))) {
    languages.push('rust');
    if (!testCommand) testCommand = 'cargo test';
    if (!buildCommand) buildCommand = 'cargo build';
  }
  if (exists(path.join(repoRoot, 'pom.xml'))) {
    languages.push('java/maven');
    if (!testCommand) testCommand = 'mvn test';
  } else if (exists(path.join(repoRoot, 'build.gradle')) || exists(path.join(repoRoot, 'build.gradle.kts'))) {
    languages.push('java/gradle');
    if (!testCommand) testCommand = './gradlew test';
  }

  return { languages, packageManager, testCommand, lintCommand, buildCommand };
}

export function initRepo(opts = {}) {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  ensureDir(repoRoot);

  // Greenfield / headless bootstrap: initialize git repository if absent
  if (opts.headless && !exists(path.join(repoRoot, '.git'))) {
    git(['init'], repoRoot, { allowFail: true });
    log.ok('headless bootstrap: initialized git repository');
  }

  const osDir = openspecDir(repoRoot);

  // 1) Resolve bundled OpenSpec engine (zero package.json / node_modules pollution in target repo),
  //    then initialize OpenSpec project structure & wire agent tooling idempotently.
  const osInstall = opts.openspec === false
    ? { installed: openspecVersion(repoRoot) != null, action: 'skipped' }
    : ensureOpenspec(repoRoot);
  if (!osInstall.installed) {
    log.warn('openspec CLI unavailable');
  } else {
    const tools = opts.tools ?? (detectTools(repoRoot).join(',') || 'none');
    const res = runOpenspec(['init', '--tools', tools, '--no-animation'], repoRoot);
    if (res.status === 0) log.ok(`openspec init --tools ${tools}`);
    else log.warn(`openspec init returned ${res.status} (non-fatal)`);
  }
  ensureDir(path.join(osDir, 'changes'));
  ensureDir(path.join(osDir, 'specs'));

  // 1.5) Managed OpenSpec schema: bundled statelessly with asdlc and optionally cached in user data dir.
  const override = localOverride(repoRoot);
  if (override.tracked) {
    log.warn(`committed local schema copy found: ${override.path}`);
    log.warn('per-repo committed schema overrides are disallowed; remove it to use the bundled schema');
  }
  try {
    const schemaDest = installSchema();
    log.ok(`synced managed schema v${builtinSchemaVersion()} -> ${path.relative(repoRoot, schemaDest) || schemaDest}`);
  } catch {
    log.info(`using stateless bundled schema v${builtinSchemaVersion()}`);
  }
  if (opts.vendor) {
    const vendored = path.join(osDir, 'schemas', SCHEMA_NAME);
    copyTree(schemaAssetDir, vendored);
    log.ok(`vendored schema -> openspec/schemas/${SCHEMA_NAME} (do not commit)`);
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

  // 3) Pre-provision remote governance labels if git remote & gh are available
  try {
    ensureRemoteLabels(repoRoot);
  } catch { /* ignore */ }

  // 4) graphify: deterministic code-only AST navigation & topology graph (no LLM key), bound to HEAD.
  if (opts.graph !== false) {
    const g = ensureGraphify();
    if (!g.installed) {
      log.warn('graphify not installed and could not be auto-installed');
      log.info('  install via internal mirror: pip install -i <mirror-url> graphifyy (or uv tool install graphifyy)');
    } else {
      if (g.action !== 'present') log.ok(`installed graphify (${g.action})`);
      const b = buildGraph(repoRoot);
      if (b.status === 0) log.ok('built graphify code graph -> graphify-out/ (bound to HEAD)');
      else log.warn('graphify build failed (non-fatal)');
      if (ensureGitignore(repoRoot)) log.ok('added graphify-out/ to .gitignore');
    }
  }

  // 4.5) Bundled Agent Skills & Slash Commands
  const explicitTools = opts.tools ? opts.tools.split(',').map((s) => s.trim().toLowerCase()) : [];
  const allTools = [...new Set([...detectTools(repoRoot), ...explicitTools])];
  installSkills(repoRoot, allTools);
  installCommands(repoRoot, allTools);

  // 5) AGENTS.md: the routing layer the agentic IDE reads
  refreshAgents(repoRoot);
  log.ok('refreshed AGENTS.md (asdlc workflow + system status)');

  // 6) Brownfield auto-discovery & stack onboarding (--onboard)
  if (opts.onboard) {
    const stack = discoverRepoStack(repoRoot);
    if (stack.testCommand && exists(configDest)) {
      const cfgText = readText(configDest);
      if (!/^\s*test_command:/m.test(cfgText)) {
        const updated = cfgText.includes('\nverify:')
          ? cfgText.replace(/(\nverify:\s*\n)/, `$1  test_command: ${JSON.stringify(stack.testCommand)}\n`)
          : `${cfgText.trimEnd()}\nverify:\n  test_command: ${JSON.stringify(stack.testCommand)}\n`;
        writeText(configDest, updated);
      }
    }
    const agentsPath = path.join(repoRoot, 'AGENTS.md');
    if (exists(agentsPath) && (stack.languages.length > 0 || stack.testCommand)) {
      const agentsText = readText(agentsPath);
      const detectedSummary = [
        stack.languages.length > 0 ? `- Stack: ${stack.languages.join(', ')}` : '',
        stack.testCommand ? `- Test command: \`${stack.testCommand}\`` : '',
        stack.lintCommand ? `- Lint command: \`${stack.lintCommand}\`` : '',
        stack.buildCommand ? `- Build command: \`${stack.buildCommand}\`` : '',
      ].filter(Boolean).join('\n');
      const block = `<!-- asdlc:stack:start -->\n## Discovered Stack\n${detectedSummary}\n<!-- asdlc:stack:end -->\n`;
      const stackRe = /<!-- asdlc:stack:start -->[\s\S]*?<!-- asdlc:stack:end -->\n?/;
      if (detectedSummary) {
        const updatedAgents = stackRe.test(agentsText)
          ? agentsText.replace(stackRe, block)
          : `${agentsText.trimEnd()}\n\n${block}`;
        writeText(agentsPath, updatedAgents);
      }
    }
    log.ok(`onboarded stack (${stack.languages.join(', ') || 'generic'}${stack.testCommand ? `; test: ${stack.testCommand}` : ''})`);
  }

  log.info('');
  log.info('Next:');
  log.info('  1. start a spec:       asdlc new "<requirement>"');
  log.info('  2. check the spec:     asdlc lint <CHANGE-ID>');
  log.info('  3. open Spec PR:       asdlc pr <CHANGE-ID> <targetBranch>');
  log.info('  4. verify & Impl PR:   asdlc verify <CHANGE-ID>');
  return repoRoot;
}

export function register(program) {
  program
    .command('init')
    .description('set up a repo: OpenSpec project + governance overlay + Graphify AST + agent skills')
    .option('--repo-root <path>', 'repository root (default: cwd)')
    .option('--tools <list>', 'OpenSpec agent tools (default: auto-detect)')
    .option('--headless', 'non-interactive bootstrap (initializes git if greenfield and skips animations)')
    .option('--onboard', 'auto-discover tech stack and test/lint commands into openspec/config.yaml & AGENTS.md')
    .option('--no-graph', 'skip graphify install/build')
    .option('--no-openspec', 'skip the openspec CLI step')
    .option('--force', 'overwrite existing governance config')
    .action((opts) => initRepo(opts));
}
