import path from 'node:path';
import { exists, readText } from '../lib/fs.js';
import { openspecDir, resolveRepoRoot } from '../lib/paths.js';
import { openspecVersion, OPENSPEC_PINNED, findOpenspec } from '../lib/openspec.js';
import { graphifyAvailable, graphStatus, GITIGNORE_LINE } from '../lib/graphify.js';
import { readInstalledVersion, builtinSchemaVersion, localOverride } from '../lib/schema.js';
import { readYaml } from '../lib/yaml.js';
import { git } from '../lib/git.js';
import { log, dim } from '../lib/log.js';

// Environment + setup health. Exit non-zero only on a critical failure
// (no OpenSpec project, or the managed schema is not installed / is overridden).
export function doctor(opts = {}) {
  const repoRoot = resolveRepoRoot(opts);
  const rows = [];
  const add = (name, status, detail) => rows.push({ name, status, detail });

  const nodeOk = /^v?\d+\./.test(process.version) && compare(process.versions.node, '20.19.0') >= 0;
  add('node >= 20.19', nodeOk ? 'pass' : 'fail', process.version);

  const osV = openNav(repoRoot);
  add('OpenSpec CLI', findOpenspec(repoRoot) ? (osV === OPENSPEC_PINNED ? 'pass' : 'warn') : 'fail',
    osV ? `${osV}${osV === OPENSPEC_PINNED ? '' : ` (pinned ${OPENSPEC_PINNED})`}` : 'not found (run `asdlc init`)');

  add('Graphify', graphifyAvailable() ? 'pass' : 'warn', graphifyAvailable() ? 'installed' : 'not found (run `asdlc init`)');

  const hasProject = exists(openspecDir(repoRoot));
  add('OpenSpec project', hasProject ? 'pass' : 'fail', hasProject ? openspecDir(repoRoot) : 'run `asdlc init`');

  const schemaV = readInstalledVersion();
  add('managed schema', schemaV ? 'pass' : 'fail', schemaV ? `v${schemaV} (bundled v${builtinSchemaVersion()})` : 'not installed (run `asdlc init`)');

  const override = localOverride(repoRoot);
  add('schema override', override.tracked ? 'fail' : 'pass',
    override.tracked ? `${override.path} COMMITTED (forbidden)` : 'none');

  const cfgPath = path.join(openspecDir(repoRoot), 'config.yaml');
  let cfgSchema = null;
  if (exists(cfgPath)) { try { cfgSchema = (readYaml(cfgPath) ?? {}).schema ?? null; } catch { /* ignore */ } }
  add('repo config schema', cfgSchema === 'agentic-repo-change' ? 'pass' : 'warn', cfgSchema ?? 'unset');

  const policy = exists(path.join(repoRoot, '.sdlc', 'policy.yaml'));
  add('.sdlc/policy.yaml', policy ? 'pass' : 'warn', policy ? '' : 'missing (run `asdlc init`)');

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

  let failed = 0;
  log.info('');
  for (const r of rows) {
    const badge = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' }[r.status];
    if (r.status === 'fail') failed += 1;
    log.plain(`  [${badge}] ${r.name}`);
    if (r.detail) log.plain(`        ${dim(r.detail)}`);
  }
  log.info('');
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
    .description('check the environment + repo setup health')
    .option('--repo-root <path>')
    .action((opts) => {
      process.exitCode = doctor(opts);
    });
}
