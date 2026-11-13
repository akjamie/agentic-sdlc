import path from 'node:path';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { exists } from '../lib/fs.js';
import { resolveRepoRoot, schemaAssetDir, openspecDir } from '../lib/paths.js';
import { installSchema, builtinSchemaVersion } from '../lib/schema.js';
import { updateRepo } from './update.js';
import { doctor } from './doctor.js';
import { log } from '../lib/log.js';

import { detectTools, installSkills } from './init.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

export function resolveRunnerImageTag(opts = {}) {
  return opts.image || process.env.ASDLC_RUNNER_IMAGE || `ghcr.io/akjamie/asdlc-runner:${pkg.version}`;
}

export function upgradeRunnerImage(opts = {}) {
  const image = resolveRunnerImageTag(opts);
  const execFn = opts.execFn || spawnSync;
  const hasDocker = Boolean(opts.execFn || which('docker'));
  if (!hasDocker) {
    log.info(`note: docker CLI not found; runner image pinned at ${image}`);
    return { pulled: false, skipped: true, image };
  }
  log.step(`syncing runner container image ${image}...`);
  const res = execFn('docker', ['pull', image], { encoding: 'utf8', stdio: opts.execFn ? 'pipe' : 'inherit' });
  if (res && res.status === 0) {
    log.ok(`synced runner image ${image}`);
    return { pulled: true, skipped: false, image };
  }
  log.warn(`runner image pull failed (${image}); container mode will attempt pull on first launch`);
  return { pulled: false, skipped: false, image };
}

function which(name) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(finder, [name], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] ?? null;
}

export function upgradeAsdlc() {
  log.step('upgrading asdlc CLI...');
  try {
    const pkgSpec = process.env.ASDLC_PKG_SPEC || '@akjamie/agentic-sdlc@latest';
    const res = spawnSync(`npm install -g ${pkgSpec}`, { shell: true, stdio: 'inherit' });
    if (res.status === 0) {
      log.ok('asdlc CLI upgraded to latest');
      return true;
    }
    throw new Error(res.error ? res.error.message : `npm exited with status ${res.status}`);
  } catch (err) {
    log.warn(`asdlc upgrade via npm failed: ${err.message}`);
    log.info('💡 [FALLBACK] If automatic upgrade failed, run manually:');
    log.info('             npm install -g --allow-git=all --force git+https://github.com/akjamie/agentic-sdlc.git');
    return false;
  }
}

export function upgradeSkills(repoRoot) {
  log.step('refreshing bundled agent skills in repository...');
  try {
    const tools = detectTools(repoRoot);
    installSkills(repoRoot, tools);
    log.ok('refreshed bundled agent skills in repository');
    return true;
  } catch (err) {
    log.warn(`skills refresh failed: ${err.message}`);
    return false;
  }
}

export function upgradeOpenspec() {
  log.step('upgrading openspec...');
  try {
    const res = spawnSync('npm install -g @fission-ai/openspec@latest', { shell: true, stdio: 'inherit' });
    if (res.status === 0) {
      log.ok('openspec upgraded to latest');
      return true;
    }
    log.info(`note: global openspec install skipped (exit ${res.status}); asdlc bundles OpenSpec natively`);
    return true;
  } catch (err) {
    log.info(`note: global openspec install skipped (${err.message}); asdlc bundles OpenSpec natively`);
    return true;
  }
}

export function upgradeGraphify() {
  log.step('upgrading graphify...');
  const viaUv = Boolean(which('uv'));
  const viaPipx = Boolean(which('pipx'));
  const viaPip = Boolean(which('pip'));

  if (viaUv) {
    try {
      // Prefer Python <3.14 to use pre-built wheels for tree-sitter, avoiding source compilation failure on experimental Pythons (e.g. 3.15)
      const res = spawnSync('uv tool install --upgrade --python "<3.14" graphifyy', { shell: true, stdio: 'inherit' });
      if (res.status === 0) {
        log.ok('graphify upgraded via uv');
        return true;
      }
      const resFallback = spawnSync('uv tool install --upgrade graphifyy', { shell: true, stdio: 'inherit' });
      if (resFallback.status === 0) {
        log.ok('graphify upgraded via uv');
        return true;
      }
    } catch {
      // fallback
    }
  }

  if (viaPipx) {
    try {
      const res = spawnSync('pipx install --upgrade graphifyy', { shell: true, stdio: 'inherit' });
      if (res.status === 0) {
        log.ok('graphify upgraded via pipx');
        return true;
      }
    } catch {
      // fallback
    }
  }

  if (viaPip) {
    try {
      const res = spawnSync('pip install --upgrade graphifyy', { shell: true, stdio: 'inherit' });
      if (res.status === 0) {
        log.ok('graphify upgraded via pip');
        return true;
      }
      // PEP 668 on Debian/Ubuntu externally-managed-environment: retry with --break-system-packages
      const resBreak = spawnSync('pip install --upgrade graphifyy --break-system-packages', { shell: true, stdio: 'inherit' });
      if (resBreak.status === 0) {
        log.ok('graphify upgraded via pip (--break-system-packages)');
        return true;
      }
      throw new Error(`pip install exited with code ${resBreak.status}`);
    } catch (err2) {
      log.warn(`graphify upgrade via pip failed: ${err2.message}`);
      log.info('💡 [HINT] If wheel build fails for tree-sitter on Python >=3.14, install with uv using Python 3.12:');
      log.info('          uv tool install --python 3.12 graphifyy');
      return false;
    }
  }

  log.warn('neither uv, pipx, nor pip found; please install/upgrade graphify manually');
  return false;
}

export function upgradeSchema() {
  log.step('refreshing BU-managed OpenSpec schema...');
  try {
    if (!exists(schemaAssetDir)) {
      log.warn(`schema asset directory missing at ${schemaAssetDir}`);
      return false;
    }
    const dest = installSchema({ force: true });
    log.ok(`refreshed schema v${builtinSchemaVersion()} -> ${dest}`);
    return true;
  } catch (err) {
    log.warn(`schema refresh failed: ${err.message}`);
    return false;
  }
}

import { installGlobalSkills } from './skills.js';

export function runUpgrade(opts = {}) {
  log.info('=== Upgrading Agentic SDLC Toolchain ===');
  log.info('');

  const repoRoot = opts.global ? null : resolveRepoRoot(opts);
  const isGit = repoRoot ? exists(path.join(repoRoot, '.git')) : false;

  if (opts.asdlc !== false) upgradeAsdlc();
  if (opts.openspec !== false) upgradeOpenspec();
  if (opts.graphify !== false) upgradeGraphify();
  if (opts.schema !== false) upgradeSchema();

  if (opts.skills !== false) {
    if (opts.global || !isGit) {
      installGlobalSkills(opts);
    } else {
      if (exists(openspecDir(repoRoot))) {
        updateRepo({ repoRoot, ...opts });
      } else {
        upgradeSkills(repoRoot);
      }
    }
  }

  if (opts.pullImage) {
    upgradeRunnerImage(opts);
  } else {
    log.info(`runner image aligned to ${resolveRunnerImageTag(opts)} (pass --pull-image to pre-pull)`);
  }

  log.info('');
  log.ok('Toolchain upgrade complete.');

  if (opts.doctor !== false) {
    log.info('');
    log.info('=== Post-upgrade Health Check (doctor) ===');
    return doctor(isGit && repoRoot ? { repoRoot } : { global: true });
  }

  return 0;
}

export function register(program) {
  program
    .command('upgrade')
    .description('upgrade the toolchain: asdlc CLI, OpenSpec, Graphify, managed schemas, and repo or global skills')
    .option('-g, --global', 'upgrade toolchain and refresh global user skills (~/.agents) for CI runners')
    .option('--pull-image', 'pre-pull version-pinned asdlc runner container image')
    .option('--image <tag>', 'override runner container image tag when pulling')
    .option('--no-asdlc', 'skip upgrading asdlc itself')
    .option('--no-openspec', 'skip upgrading openspec')
    .option('--no-graphify', 'skip upgrading graphify')
    .option('--no-schema', 'skip refreshing BU-managed schema')
    .option('--no-skills', 'skip refreshing skills')
    .option('--no-doctor', 'skip running post-upgrade doctor check')
    .option('--repo-root <path>')
    .action((opts) => {
      process.exitCode = runUpgrade(opts);
    });
}
