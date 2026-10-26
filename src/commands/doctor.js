import path from 'node:path';
import { exists, readText, writeText, copyTree, ensureDir } from '../lib/fs.js';
import { openspecDir, resolveRepoRoot, policyAssetFile, githooksAssetDir } from '../lib/paths.js';
import { openspecVersion, OPENSPEC_PINNED, findOpenspec } from '../lib/openspec.js';
import { graphifyAvailable, graphStatus, GITIGNORE_LINE, ensureGraphify } from '../lib/graphify.js';
import { readInstalledVersion, builtinSchemaVersion, localOverride, installSchema } from '../lib/schema.js';
import { refreshAgents } from '../lib/agents.js';
import { readYaml } from '../lib/yaml.js';
import { git } from '../lib/git.js';
import { log, dim } from '../lib/log.js';

// Environment + setup health. Exit non-zero only on a critical failure
// (no OpenSpec project, or the managed schema is not installed / is overridden).
export function doctor(opts = {}) {
  const isGlobal = Boolean(opts.global);
  const repoRoot = opts.global ? null : resolveRepoRoot(opts);
  const hasProject = repoRoot ? exists(openspecDir(repoRoot)) : false;
  const isRepo = repoRoot ? exists(path.join(repoRoot, '.git')) : false;

  const rows = [];
  const add = (name, status, detail) => rows.push({ name, status, detail });

  // 1) Environment & Toolchain checks (run in all modes)
  const nodeOk = /^v?\d+\./.test(process.version) && compare(process.versions.node, '20.19.0') >= 0;
  add('node >= 20.19', nodeOk ? 'pass' : 'fail', process.version);

  const checkCwd = repoRoot || process.cwd();
  const osV = openNav(checkCwd);
  add('OpenSpec CLI', findOpenspec(checkCwd) ? (osV === OPENSPEC_PINNED ? 'pass' : 'warn') : 'fail',
    osV ? `${osV}${osV === OPENSPEC_PINNED ? '' : ` (pinned ${OPENSPEC_PINNED})`}` : 'not found (run `npm install -g @fission-ai/openspec`)');

  add('Graphify', graphifyAvailable() ? 'pass' : 'warn', graphifyAvailable() ? 'installed' : 'not found (install via uv tool install graphifyy or pip)');

  const schemaV = readInstalledVersion();
  add('managed schema', schemaV ? 'pass' : 'fail', schemaV ? `v${schemaV} (bundled v${builtinSchemaVersion()})` : 'not installed (run `asdlc init` or `asdlc upgrade`)');

  // If in global mode or not in a repository workspace, check global skills and skip repo-specific checks
  if (isGlobal || (!isRepo && !hasProject)) {
    const globalSkills = path.join(process.env.HOME || process.env.USERPROFILE || '', '.agents', 'skills');
    const hasGlobalSkills = exists(globalSkills);
    add('global skills (~/.agents)', hasGlobalSkills ? 'pass' : 'warn', hasGlobalSkills ? 'installed' : 'run `asdlc skills install --global`');
  } else {
    // 2) Repository Workspace Checks (only when inside an actual repo)
    add('OpenSpec project', hasProject ? 'pass' : 'fail', hasProject ? openspecDir(repoRoot) : 'run `asdlc init`');

    const override = localOverride(repoRoot);
    add('schema override', override.tracked ? 'fail' : 'pass',
      override.tracked ? `${override.path} COMMITTED (forbidden)` : 'none');

    const cfgPath = path.join(openspecDir(repoRoot), 'config.yaml');
    let cfgSchema = null;
    if (exists(cfgPath)) { try { cfgSchema = (readYaml(cfgPath) ?? {}).schema ?? null; } catch { /* ignore */ } }
    add('repo config schema', cfgSchema === 'agentic-repo-change' ? 'pass' : 'warn', cfgSchema ?? 'unset');

    let hooksPath = null;
    try { hooksPath = git(['config', '--get', 'core.hooksPath'], repoRoot, { allowFail: true }); } catch { /* ignore */ }
    add('.githooks', hooksPath === '.githooks' ? 'pass' : 'warn', hooksPath === '.githooks' ? 'core.hooksPath=.githooks' : `core.hooksPath=${hooksPath ?? 'unset'}`);

    const agents = path.join(repoRoot, 'AGENTS.md');
    const hasRouting = exists(agents) && readText(agents).includes('<!-- asdlc:routing -->');
    add('AGENTS.md routing', hasRouting ? 'pass' : 'warn', hasRouting ? '' : 'missing (run `asdlc init`)');

    const gstatus = graphStatus(repoRoot);
    add('knowledge graph', gstatus === 'fresh' ? 'pass' : 'warn', gstatus);

    const gi = path.join(repoRoot, '.gitignore');
    const ignored = exists(gi) && readText(gi).split(/\r?\n/).some((l) => l.trim() === GITIGNORE_LINE);
    add('graphify-out ignored', ignored ? 'pass' : 'warn', ignored ? '' : `add ${GITIGNORE_LINE} to .gitignore`);
  }

  let failed = 0;
  log.info('');
  for (const r of rows) {
    const badge = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' }[r.status];
    if (r.status === 'fail') failed += 1;
    log.plain(`  [${badge}] ${r.name}`);
    if (r.detail) log.plain(`        ${dim(r.detail)}`);
  }
  log.info('');

  if (opts.fix) {
    log.step('attempting automated remediation (--fix)...');

    // 1. Managed schema
    if (!schemaV) {
      try { installSchema(); log.ok('fixed: installed managed schema'); } catch (e) { log.warn(`fix failed for schema: ${e.message}`); }
    }

    // 2. .gitignore graphify-out
    if (!ignored) {
      try {
        const text = exists(gi) ? readText(gi) : '';
        writeText(gi, `${text.trimEnd()}\n${GITIGNORE_LINE}\n`);
        log.ok('fixed: added graphify-out/ to .gitignore');
      } catch (e) { log.warn(`fix failed for .gitignore: ${e.message}`); }
    }

    // 3. .githooks
    if (hooksPath !== '.githooks') {
      try {
        if (exists(githooksAssetDir)) {
          copyTree(githooksAssetDir, path.join(repoRoot, '.githooks'));
        }
        git(['config', 'core.hooksPath', '.githooks'], repoRoot);
        log.ok('fixed: configured git core.hooksPath -> .githooks');
      } catch (e) { log.warn(`fix failed for githooks: ${e.message}`); }
    }

    // 5. AGENTS.md routing
    if (!hasRouting) {
      try {
        refreshAgents(repoRoot);
        log.ok('fixed: refreshed AGENTS.md routing');
      } catch (e) { log.warn(`fix failed for AGENTS.md: ${e.message}`); }
    }

    // 6. Graphify install
    if (!graphifyAvailable()) {
      try {
        const g = ensureGraphify();
        if (g.installed) log.ok('fixed: installed graphify CLI');
      } catch (e) { log.warn(`fix failed for graphify: ${e.message}`); }
    }
    log.info('');
  }

  log.plain(failed ? `doctor: ${failed} critical issue(s)` : 'doctor: ok');
  return failed ? 1 : 0;
}

function compare(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

function openNav(repoRoot) { return openspecVersion(repoRoot); }

export function register(program) {
  program
    .command('doctor')
    .description('check the environment + repo setup health (with optional --fix)')
    .option('-g, --global', 'check global toolchain and agent skills only (for CI/headless environments)')
    .option('--fix', 'automatically remediate fixable environment and configuration drift')
    .option('--repo-root <path>')
    .action((opts) => {
      process.exitCode = doctor(opts);
    });
}
